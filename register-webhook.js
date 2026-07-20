/**
 * Run this ONCE to register the webhook, after your Render app is live.
 * Usage: node register-webhook.js
 */
require("dotenv").config();
const fetch = require("node-fetch");

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const CALLBACK_URL = process.env.RENDER_APP_URL; // e.g. https://returns-automation.onrender.com/webhooks/returns-request

async function main() {
  if (!CALLBACK_URL) {
    console.error("Set RENDER_APP_URL in your .env first, e.g. https://returns-automation.onrender.com/webhooks/returns-request");
    process.exit(1);
  }

  const mutation = `
    mutation {
      webhookSubscriptionCreate(
        topic: RETURNS_REQUEST
        webhookSubscription: {
          callbackUrl: "${CALLBACK_URL}"
          format: JSON
        }
      ) {
        webhookSubscription { id callbackUrl }
        userErrors { field message }
      }
    }
  `;

  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query: mutation }),
  });

  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

main();
