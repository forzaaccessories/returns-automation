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
  const taxRate = parseFloat(process.env.UNLEASHED_TAX_RATE || "0.15");

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
      // line.unitPrice from Shopify is VAT-inclusive (what the customer
      // paid). Unleashed's CreditPrice needs to be the EX-VAT amount -
      // it adds VAT on top itself to reach the inclusive total.
      CreditPrice: Math.round((line.unitPrice / (1 + taxRate)) * 100) / 100,
      Reason: reason || "Customer return",
      // Don't auto-restock: physical stock goes into a returns bin first
      // for inspection/repackaging before being manually added back via
      // a stock adjustment once checked.
      Return: false,
    })),
  };
  console.log("Unleashed /CreditNotes/FreeCredit request payload:", JSON.stringify(payload));
  const createdNote = await unleashedRequest("/CreditNotes/FreeCredit", "POST", payload);

  // New credit notes land in "Parked" status by default - complete it
  // immediately so it doesn't sit waiting for manual completion.
  if (createdNote?.Guid) {
    await unleashedRequest(`/CreditNotes/${createdNote.Guid}/Complete`, "POST", {});
  }

  return createdNote;
}

/**
 * Creates a new Sales Order for an exchange, set to "Placed" so the
 * warehouse picking queue picks it up automatically.
 *
 * Unleashed requires Tax, TaxRate, SubTotal, TaxTotal, and Total to be
 * calculated and included on POST (confirmed via their docs table) -
 * unlike Credit Notes, these aren't auto-calculated server-side, so we
 * compute them from the line items ourselves.
 */
async function createExchangeSalesOrder({ customerCode, lines, comments }) {
  const taxRate = parseFloat(process.env.UNLEASHED_TAX_RATE || "0.15");

  const salesOrderLines = lines.map((line, i) => {
    const lineTotal = Math.round(line.quantity * line.unitPrice * 100) / 100;
    const lineTax = Math.round(lineTotal * taxRate * 100) / 100;
    return {
      LineNumber: i + 1,
      Product: { ProductCode: line.productCode },
      OrderQuantity: line.quantity,
      UnitPrice: line.unitPrice ?? 0,
      LineTotal: lineTotal,
      TaxRate: taxRate,
      LineTax: lineTax,
    };
  });

  const subTotal = Math.round(salesOrderLines.reduce((sum, l) => sum + l.LineTotal, 0) * 100) / 100;
  const taxTotal = Math.round(salesOrderLines.reduce((sum, l) => sum + l.LineTax, 0) * 100) / 100;
  const total = Math.round((subTotal + taxTotal) * 100) / 100;

  const payload = {
    Customer: { Guid: customerCode },
    Warehouse: { WarehouseCode: process.env.UNLEASHED_WAREHOUSE_CODE },
    OrderDate: new Date().toISOString(),
    RequiredDate: new Date().toISOString(),
    OrderStatus: "Placed",
    Comments: comments || "Exchange order - auto-created",
    ExchangeRate: 1,
    Tax: { TaxCode: process.env.UNLEASHED_TAX_CODE, TaxRate: taxRate },
    TaxRate: taxRate,
    SubTotal: subTotal,
    TaxTotal: taxTotal,
    Total: total,
    SalesOrderLines: salesOrderLines,
  };
  console.log("Unleashed /SalesOrders request payload:", JSON.stringify(payload));
  return unleashedRequest("/SalesOrders", "POST", payload);
}

module.exports = { findSalesOrderByNumber, createCreditNote, createExchangeSalesOrder };
