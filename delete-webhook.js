/**
 * Usage: node delete-webhook.js "gid://shopify/WebhookSubscription/XXXXXXXXXX"
 * Get the ID to delete from running list-webhooks.js first.
 */
require("dotenv").config();
const fetch = require("node-fetch");
const { getAccessToken } = require("./services/shopifyAuth");

const STORE = process.env.SHOPIFY_STORE;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

async function main() {
  const idToDelete = process.argv[2];
  if (!idToDelete) {
    console.error('Usage: node delete-webhook.js "gid://shopify/WebhookSubscription/XXXXXXXXXX"');
    process.exit(1);
  }

  const token = await getAccessToken();
  const mutation = `
    mutation {
      webhookSubscriptionDelete(id: "${idToDelete}") {
        deletedWebhookSubscriptionId
        userErrors { field message }
      }
    }
  `;

  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query: mutation }),
  });

  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

main();
