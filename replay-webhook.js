/**
 * Usage: node replay-webhook.js "gid://shopify/Return/1234567890"
 *
 * Manually fires your Render app's /webhooks/returns-approved endpoint
 * for a return you've already created/approved in Shopify - useful for
 * repeated testing without creating a brand new order/exchange every time.
 *
 * This builds a real, correctly-signed webhook request using your
 * SHOPIFY_WEBHOOK_SECRET, so it's indistinguishable from Shopify actually
 * sending it - your app will process it exactly the same way.
 */
require("dotenv").config();
const fetch = require("node-fetch");
const crypto = require("crypto");

const RENDER_APP_URL = process.env.RENDER_APP_URL; // e.g. https://returns-automation-fnk7.onrender.com/webhooks/returns-approved
const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

async function main() {
  const returnGid = process.argv[2];
  if (!returnGid) {
    console.error('Usage: node replay-webhook.js "gid://shopify/Return/1234567890"');
    console.error("Get the GID by running: node find-return.js <order-number>");
    process.exit(1);
  }
  if (!RENDER_APP_URL) {
    console.error("Set RENDER_APP_URL in your .env first.");
    process.exit(1);
  }

  const body = JSON.stringify({ admin_graphql_api_id: returnGid });
  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET).update(body, "utf8").digest("base64");

  const res = await fetch(RENDER_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": hmac,
    },
    body,
  });

  console.log("Response status:", res.status);
  console.log("Response body:", await res.text());
  console.log("\nNow check Render's Logs tab to watch the automation run.");
}

main();
