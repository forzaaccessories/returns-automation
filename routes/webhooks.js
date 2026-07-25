const express = require("express");
const router = express.Router();

const { verifyShopifyWebhook } = require("../utils/verifyShopifyWebhook");
const { getReturnDetails, addOrderNote, uploadReturnLabelAndNotify } = require("../services/shopify");
const { bookReturnCollection } = require("../services/bobgo");
const { findSalesOrderByNumber, createCreditNote, createExchangeSalesOrder } = require("../services/unleashed");

// This fires when YOU click "Process return" in Shopify admin (topic:
// returns/process) - this is the step AFTER "Approve", and is when
// Shopify actually finalizes the exchange line item data (the replacement
// product/SKU). Approving alone doesn't populate that data yet.
//
// This route needs the RAW body for HMAC verification,
// so it's mounted with express.raw() in server.js (not express.json()).
router.post("/returns-processed", async (req, res) => {
  const hmac = req.get("X-Shopify-Hmac-Sha256");
  const valid = verifyShopifyWebhook(req.body, hmac, process.env.SHOPIFY_WEBHOOK_SECRET);

  if (!valid) {
    console.warn("Invalid Shopify webhook signature");
    return res.status(401).send("Invalid signature");
  }

  // Acknowledge immediately so Shopify doesn't retry; do the real work after.
  res.status(200).send("OK");

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch (err) {
    console.error("Failed to parse webhook payload", err);
    return;
  }

  try {
    await processReturnRequest(payload);
  } catch (err) {
    console.error("Failed to process return request:", err);
    // TODO: send yourself an alert (email/Slack) here so a failed
    // automation run never goes unnoticed.
  }
});

async function processReturnRequest(payload) {
  const returnGid = payload.admin_graphql_api_id || payload.id;
  let returnDetails = await getReturnDetails(returnGid);

  if (!returnDetails) {
    console.error("Could not fetch return details for", returnGid);
    return;
  }

  // If this is an exchange but the line item product data hasn't attached
  // yet (seen in testing - looks like a timing gap in Shopify right after
  // approval), wait briefly and re-fetch once before giving up on it.
  const hasEmptyExchangeData = returnDetails.exchangeLineItems?.nodes?.some(
    (node) => !node.lineItems || node.lineItems.length === 0
  );
  if (returnDetails.exchangeLineItems?.nodes?.length > 0 && hasEmptyExchangeData) {
    console.log("Exchange line item data not populated yet - waiting 5s and re-fetching once.");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    returnDetails = await getReturnDetails(returnGid);
  }

  const { order, returnLineItems, exchangeLineItems, reverseFulfillmentOrders } = returnDetails;
  console.log("Raw returnDetails.exchangeLineItems:", JSON.stringify(exchangeLineItems));
  console.log("Raw order.customer:", JSON.stringify(order.customer));
  console.log("Raw order.shippingAddress:", JSON.stringify(order.shippingAddress));
  const isExchange = exchangeLineItems?.nodes?.length > 0;
  const customer = order.customer || {};
  const address = order.shippingAddress || {};

  // 1. Book the collection waybill via BobGo
  const collection = await bookReturnCollection({
    customer,
    address,
    parcels: [],
    reference: order.name,
    customerEmail: order.email,
  });

  // 2. Upload the waybill into Shopify's return record and let Shopify
  // send its own "your return label is ready" email to the customer.
  const reverseFulfillmentOrderId = reverseFulfillmentOrders?.nodes?.[0]?.id;
  if (!reverseFulfillmentOrderId) {
    console.error(`No reverse fulfillment order found for return on ${order.name} - cannot upload waybill.`);
  } else if (!collection.waybillUrl) {
    console.error(`BobGo waybill wasn't ready in time for order ${order.name} - skipping Shopify label upload. Tracking: ${collection.trackingNumber}. You may need to upload it manually or re-run this step once BobGo finishes processing.`);
  } else {
    await uploadReturnLabelAndNotify({
      reverseFulfillmentOrderId,
      fileUrl: collection.waybillUrl,
    });
  }

  // 3. Leave a note on the Shopify order for staff visibility
  await addOrderNote(
    order.id,
    `Automation: booked BobGo collection (tracking ${collection.trackingNumber}) and uploaded waybill to Shopify - customer notified.`
  );

  // 4. Credit the return in Unleashed
  // Shopify order name is like "#1234"; Unleashed order number is "SHOPIFY-1234-WEB"
  const orderNumberDigits = order.name.replace("#", "");
  const unleashedOrderNumber = `SHOPIFY-${orderNumberDigits}-WEB`;
  const unleashedOrder = await findSalesOrderByNumber(unleashedOrderNumber);
  if (!unleashedOrder) {
    console.error(`No matching Unleashed sales order found for ${unleashedOrderNumber} (Shopify order ${order.name}) - skipping credit note.`);
  } else {
    const creditLines = returnLineItems.nodes.map((item) => {
      const lineItem = item.fulfillmentLineItem.lineItem;
      // Use the discounted price (what the customer actually paid per unit),
      // not the original list price, so the credit matches their receipt.
      // discountedUnitPriceSet does NOT include coupon codes/order-level
      // discounts per Shopify's own docs - only discountedUnitPriceAfterAllDiscountsSet does.
      const unitPrice = parseFloat(lineItem.discountedUnitPriceAfterAllDiscountsSet.shopMoney.amount);
      return {
        productCode: lineItem.sku,
        quantity: item.quantity,
        unitPrice,
      };
    });
    await createCreditNote({
      customerCode: unleashedOrder.Customer.Guid,
      lines: creditLines,
      reason: isExchange ? "Exchange" : "Return",
      referenceOrderName: order.name,
    });
  }

  // Work out the discount % the customer got on their original order
  // (from the first returned line item), so the same discount can be
  // applied to the price of whatever replacement item they're exchanging
  // into - not just the replacement item's undiscounted list price.
  let discountRatio = 1;
  const firstReturnLineItem = returnLineItems.nodes[0]?.fulfillmentLineItem?.lineItem;
  if (firstReturnLineItem) {
    const originalPrice = parseFloat(firstReturnLineItem.originalUnitPriceSet.shopMoney.amount);
    const discountedPrice = parseFloat(firstReturnLineItem.discountedUnitPriceAfterAllDiscountsSet.shopMoney.amount);
    if (originalPrice > 0) {
      discountRatio = discountedPrice / originalPrice;
    }
  }

  // 5. If it's an exchange, create the new sales order for the warehouse to pick
  if (isExchange && unleashedOrder) {
    const exchangeLines = exchangeLineItems.nodes.map((item) => {
      // Exchange items weren't part of the original order, so there's no
      // "previous" price to reuse - use the item's current Shopify price,
      // with the same discount % the customer got on their original order applied.
      const lineItem = item.lineItems?.[0];
      const currentPrice = parseFloat(lineItem?.variant?.price ?? 0);
      const discountedPrice = Math.round(currentPrice * discountRatio * 100) / 100;
      return {
        productCode: lineItem?.sku,
        quantity: item.quantity,
        unitPrice: discountedPrice,
      };
    });

    const hasValidProduct = exchangeLines.every((line) => line.productCode);
    if (!hasValidProduct) {
      console.error(`Exchange product data still missing for order ${order.name} after retry - skipping Unleashed exchange order. The credit note above was still created; you'll need to manually create the exchange sales order in Unleashed for this one.`);
    } else {
    await createExchangeSalesOrder({
      customerCode: unleashedOrder.Customer.Guid,
      lines: exchangeLines,
      comments: `Exchange for original order ${order.name}`,
      delivery: {
        name: `${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
        address1: address.address1 || "",
        address2: address.address2 || "",
        city: address.city || "",
        region: address.province || "",
        country: address.country || "",
        postCode: address.zip || "",
      },
    });
    }
  }

  console.log(`Processed ${isExchange ? "exchange" : "return"} for order ${order.name}`);
}

module.exports = router;
