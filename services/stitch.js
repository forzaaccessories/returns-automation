const fetch = require("node-fetch");

const BASE_URL = "https://express.stitch.money";
const CLIENT_ID = process.env.STITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.STITCH_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiresAt = 0;

/** Stitch tokens last 15 minutes - cache and refresh 1 minute early. */
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const res = await fetch(`${BASE_URL}/api/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      scope: "client_paymentrequest",
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`Stitch auth failed: ${JSON.stringify(json)}`);
  }

  cachedToken = json.data.accessToken;
  tokenExpiresAt = Date.now() + 14 * 60 * 1000; // refresh a minute early
  return cachedToken;
}

/**
 * Creates a Stitch payment link for the amount the customer still owes
 * on an exchange (when the replacement item costs more than what they
 * already paid for the returned item).
 * amountRands: a normal Rand amount e.g. 150.50 - converted to cents here.
 */
async function createPaymentLink({ amountRands, payerName, merchantReference }) {
  const token = await getAccessToken();
  const amountCents = Math.round(amountRands * 100);

  const res = await fetch(`${BASE_URL}/api/v1/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountCents,
      payerName,
      merchantReference,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`Stitch create payment link failed: ${JSON.stringify(json)}`);
  }
  return json.data.payment; // { id, amount, status, payerName, link, expireAt }
}

/** Fetches full payment details - needed because the webhook payload itself
 * doesn't include merchantReference, only the payment ID. */
async function getPayment(paymentId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/api/v1/payment/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`Stitch get payment failed: ${JSON.stringify(json)}`);
  }
  return json.data.payment;
}

module.exports = { getAccessToken, createPaymentLink, getPayment };
