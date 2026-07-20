require("dotenv").config();
const fetch = require("node-fetch");
const { getAccessToken } = require("./services/shopifyAuth");

const STORE = process.env.SHOPIFY_STORE;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

async function main() {
  const token = await getAccessToken();
  const query = `
    {
      webhookSubscriptions(first: 20) {
        nodes {
          id
          topic
          callbackUrl
        }
      }
    }
  `;

  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query }),
  });

  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

main();
