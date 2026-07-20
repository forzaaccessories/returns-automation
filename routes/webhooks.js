const express = require("express");
const router = express.Router();

const { verifyShopifyWebhook } = require("../utils/verifyShopifyWebhook");
const { getReturnDetails, addOrderNote, uploadReturnLabelAndNotify } = require("../services/shopify");
const { bookReturnCollection } = require("../services/bobgo");
const { findSalesOrderByNumber, createCreditNote, createExchangeSalesOrder } = require("../services/unleashed");

// This fires when YOU approve a return/exchange request in Shopify admin
// (topic: returns/approve) - not when the customer first submits it.
// This means the automation only runs after your manual review, so
// self-serve requests never get auto-processed without a human check.
//
// This route needs the RAW body for HMAC verification,
// so it's mounted with express.raw() in server.js (not express.json()).
router.post("/returns-approved", async (req, res) => {
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
  const returnDetails = await getReturnDetails(returnGid);

  if (!returnDetails) {
    console.error("Could not fetch return details for", returnGid);
    return;
  }

  const { order, returnLineItems, exchangeLineItems, reverseFulfillmentOrders } = returnDetails;
  const isExchange = exchangeLineItems?.nodes?.length > 0;
  const customer = order.customer || {};
  const address = order.shippingAddress || {};

  // 1. Book the collection waybill via BobGo
  const collection = await bookReturnCollection({
    customer,
    address,
    parcels: [],
    reference: order.name,
  });

  // 2. Upload the waybill into Shopify's return record and let Shopify
  // send its own "your return label is ready" email to the customer.
  const reverseFulfillmentOrderId = reverseFulfillmentOrders?.nodes?.[0]?.id;
  if (!reverseFulfillmentOrderId) {
    console.error(`No reverse fulfillment order found for return on ${order.name} - cannot upload waybill.`);
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
  // Shopify order name is like "#1234"; Unleashed order number is "-WEBSHOPIFY-1234"
  const orderNumberDigits = order.name.replace("#", "");
  const unleashedOrderNumber = `-WEBSHOPIFY-${orderNumberDigits}`;
  const unleashedOrder = await findSalesOrderByNumber(unleashedOrderNumber);
  if (!unleashedOrder) {
    console.error(`No matching Unleashed sales order found for ${unleashedOrderNumber} (Shopify order ${order.name}) - skipping credit note.`);
  } else {
    const creditLines = returnLineItems.nodes.map((item) => {
      const lineItem = item.fulfillmentLineItem.lineItem;
      // Use the discounted price (what the customer actually paid per unit),
      // not the original list price, so the credit matches their receipt.
      const unitPrice = parseFloat(lineItem.discountedUnitPriceSet.shopMoney.amount);
      return {
        productCode: lineItem.sku,
        quantity: item.quantity,
        unitPrice,
      };
    });
    await createCreditNote({
      salesOrderGuid: unleashedOrder.Guid,
      customerCode: unleashedOrder.Customer.Guid,
      lines: creditLines,
      reason: isExchange ? "Exchange" : "Return",
    });
  }

  // 5. If it's an exchange, create the new sales order for the warehouse to pick
  if (isExchange && unleashedOrder) {
    const exchangeLines = exchangeLineItems.nodes.map((item) => {
      // Exchange items weren't part of the original order, so there's no
      // "previous" price to reuse - use the item's current Shopify price.
      const lineItem = item.lineItems?.nodes?.[0];
      return {
        productCode: lineItem?.sku,
        quantity: item.quantity,
        unitPrice: parseFloat(lineItem?.variant?.price ?? 0),
      };
    });
    await createExchangeSalesOrder({
      customerCode: unleashedOrder.Customer.Guid,
      lines: exchangeLines,
      comments: `Exchange for original order ${order.name}`,
    });
  }

  console.log(`Processed ${isExchange ? "exchange" : "return"} for order ${order.name}`);
}

module.exports = router;
