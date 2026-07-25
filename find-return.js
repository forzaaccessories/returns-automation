/**
 * Usage: node find-return.js 7931
 * Looks up an order by number and lists its returns with their GIDs,
 * so you can reuse one for repeated local testing instead of creating
 * a fresh test order every time.
 */
require("dotenv").config();
const fetch = require("node-fetch");
const { getAccessToken } = require("./services/shopifyAuth");

const STORE = process.env.SHOPIFY_STORE;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

async function main() {
  const orderNumber = process.argv[2];
  if (!orderNumber) {
    console.error("Usage: node find-return.js <order-number, e.g. 7931>");
    process.exit(1);
  }

  const token = await getAccessToken();
  const query = `
    query {
      orders(first: 1, query: "name:#${orderNumber}") {
        nodes {
          id
          name
          returns(first: 10) {
            nodes {
              id
              name
              status
            }
          }
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
