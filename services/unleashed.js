const fetch = require("node-fetch");
const crypto = require("crypto");

const BASE_URL = process.env.UNLEASHED_BASE_URL || "https://api.unleashedsoftware.com";
const API_ID = process.env.UNLEASHED_API_ID;
const API_KEY = process.env.UNLEASHED_API_KEY;

/**
 * Unleashed signs requests using HMAC-SHA256 over the query string
 * portion of the URL (NOT the body), base64-encoded.
 * Docs: https://apidocs.unleashedsoftware.com/
 */
function signQuery(queryString) {
  return crypto
    .createHmac("sha256", API_KEY)
    .update(queryString || "")
    .digest("base64");
}

async function unleashedRequest(path, method = "GET", body = null, queryString = "") {
  const signature = signQuery(queryString);
  const url = `${BASE_URL}${path}${queryString ? `?${queryString}` : ""}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-auth-id": API_ID,
      "api-auth-signature": signature,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`Unleashed API error (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

/** Look up a Sales Order by its order number (must match how Shopify order names map to Unleashed) */
async function findSalesOrderByNumber(orderNumber) {
  const query = `orderNumber=${encodeURIComponent(orderNumber)}`;
  const data = await unleashedRequest("/SalesOrders", "GET", null, query);
  return data.Items?.[0] || null;
}

/**
 * Creates a Credit Note against a completed Sales Order/Invoice for the
 * returned line items. `lines` = [{ productCode, quantity, unitPrice }]
 */
async function createCreditNote({ salesOrderGuid, customerCode, lines, reason }) {
  const payload = {
    Customer: { Guid: customerCode },
    CreditDate: new Date().toISOString(),
    SalesOrders: [{ Guid: salesOrderGuid }],
    CreditLines: lines.map((line) => ({
      Product: { ProductCode: line.productCode },
      OrderQuantity: line.quantity,
      UnitPrice: line.unitPrice,
      Return: true, // return the stock to inventory
      Comments: reason || "Customer return",
    })),
  };
  return unleashedRequest("/CreditNotes", "POST", payload);
}

/**
 * Creates a new Sales Order for an exchange, set to "Placed" so the
 * warehouse picking queue picks it up automatically.
 */
async function createExchangeSalesOrder({ customerCode, lines, comments }) {
  const payload = {
    Customer: { Guid: customerCode },
    Warehouse: { WarehouseCode: process.env.UNLEASHED_WAREHOUSE_CODE },
    OrderDate: new Date().toISOString(),
    RequiredDate: new Date().toISOString(),
    OrderStatus: "Placed",
    Comments: comments || "Exchange order - auto-created",
    SalesOrderLines: lines.map((line, i) => ({
      LineNumber: i + 1,
      Product: { ProductCode: line.productCode },
      OrderQuantity: line.quantity,
      UnitPrice: line.unitPrice ?? 0,
    })),
  };
  return unleashedRequest("/SalesOrders", "POST", payload);
}

module.exports = { findSalesOrderByNumber, createCreditNote, createExchangeSalesOrder };
