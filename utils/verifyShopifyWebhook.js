const crypto = require("crypto");

/**
 * Verifies that an incoming webhook actually came from Shopify.
 * Must be run against the RAW request body (before JSON parsing).
 */
function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!hmacHeader) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  // timing-safe compare
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { verifyShopifyWebhook };
