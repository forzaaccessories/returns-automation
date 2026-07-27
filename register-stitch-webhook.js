/**
 * Run this ONCE to register your Stitch webhook endpoint.
 * Usage: node register-stitch-webhook.js
 *
 * IMPORTANT: the response includes a signing secret shown only once -
 * copy it immediately into STITCH_WEBHOOK_SECRET in your .env AND Render.
 */
require("dotenv").config();
const fetch = require("node-fetch");
const { getAccessToken } = require("./services/stitch");

async function main() {
  const renderUrl = process.env.RENDER_APP_URL_BASE; // e.g. https://returns-automation-fnk7.onrender.com (no path)
  if (!renderUrl) {
    console.error("Set RENDER_APP_URL_BASE in your .env first, e.g. https://returns-automation-fnk7.onrender.com (just the base, no /webhooks/... path)");
    process.exit(1);
  }

  const token = await getAccessToken();
  const webhookUrl = `${renderUrl}/webhooks/stitch`;

  const res = await fetch("https://express.stitch.money/api/v1/webhook", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: webhookUrl }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(`Stitch returned a non-JSON response (status ${res.status}):`, text);
    if (res.status === 409) {
      console.error("\nThis means a webhook for this URL already exists. Go to the Stitch Express dashboard's Webhooks page, delete the existing one, then run this script again.");
    }
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));

  if (json.success) {
    console.log("\n=== IMPORTANT ===");
    console.log("Copy this secret into STITCH_WEBHOOK_SECRET in your .env AND Render now:");
    console.log(json.data.secret);
  }
}

main();
