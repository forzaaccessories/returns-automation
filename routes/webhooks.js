const express = require("express");
const router = express.Router();

const { verifyShopifyWebhook } = require("../utils/verifyShopifyWebhook");
const { getReturnDetails, addOrderNote } = require("../services/shopify");
const { bookReturnCollection } = require("../services/bobgo");
const { findSalesOrderByNumber, createCreditNote, createExchangeSalesOrder } = require("../services/unleashed");
const { sendWaybillEmail } = require("../services/email");

// IMPORTANT: this route needs the RAW body for HMAC verification,
// so it's mounted with express.raw() in server.js (not express.json()).
router.post("/returns-request", async (req, res) => {
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

  const { order, returnLineItems, exchangeLineItems } = returnDetails;
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

  // 2. Email the waybill to the customer
  await sendWaybillEmail({
    to: order.email,
    customerName: customer.firstName || "there",
    orderName: order.name,
    waybillUrl: collection.waybillUrl,
    trackingNumber: collection.trackingNumber,
    isExchange,
  });

  // 3. Leave a note on the Shopify order for staff visibility
  await addOrderNote(
    order.id,
    `Automation: booked BobGo collection (tracking ${collection.trackingNumber}) and emailed customer.`
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
    const exchangeLines = exchangeLineItems.nodes.map((item) => ({
      productCode: item.variant.sku,
      quantity: item.quantity,
      // Exchange items weren't part of the original order, so there's no
      // "previous" price to reuse - use the item's current Shopify price.
      unitPrice: parseFloat(item.variant.price),
    }));
    await createExchangeSalesOrder({
      customerCode: unleashedOrder.Customer.Guid,
      lines: exchangeLines,
      comments: `Exchange for original order ${order.name}`,
    });
  }

  console.log(`Processed ${isExchange ? "exchange" : "return"} for order ${order.name}`);
}

module.exports = router;
