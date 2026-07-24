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
 * Creates a Credit Note for the returned line items.
 *
 * IMPORTANT: Unleashed's API only supports creating "Free Credit" notes
 * (POST /CreditNotes/FreeCredit) - it does NOT support creating a credit
 * note directly linked to an existing Sales Order/Invoice via API (that's
 * only possible manually in their UI). A Free Credit is a standalone
 * credit note, so we put the Shopify order number in the Reference field
 * for traceability back to the original order.
 * Docs: https://apidocs.unleashedsoftware.com/CreditNotes
 */
async function createCreditNote({ customerCode, lines, reason, referenceOrderName }) {
  const payload = {
    Comments: reason || "Customer return",
    CreditDate: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    ExchangeRate: 1,
    Reference: referenceOrderName || "",
    Warehouse: { WarehouseCode: process.env.UNLEASHED_WAREHOUSE_CODE },
    Customer: { Guid: customerCode },
    Tax: { TaxCode: process.env.UNLEASHED_TAX_CODE },
    CreditLines: lines.map((line) => ({
      Product: { ProductCode: line.productCode },
      CreditQuantity: line.quantity,
      CreditPrice: line.unitPrice,
      Reason: reason || "Customer return",
      Return: true, // return the stock to inventory
    })),
  };
  return unleashedRequest("/CreditNotes/FreeCredit", "POST", payload);
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
