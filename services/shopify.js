const fetch = require("node-fetch");
const { getAccessToken } = require("./shopifyAuth");

const STORE = process.env.SHOPIFY_STORE;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";
const ENDPOINT = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

async function shopifyGraphQL(query, variables = {}) {
  const token = await getAccessToken();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/**
 * Given a Return's admin_graphql_api_id (from the webhook payload),
 * fetch full details: line items being returned, any exchange items
 * requested, the order, and the customer's shipping address.
 */
async function getReturnDetails(returnGid) {
  const query = `
    query GetReturn($id: ID!) {
      return(id: $id) {
        id
        name
        status
        returnLineItems(first: 25) {
          nodes {
            id
            quantity
            ... on ReturnLineItem {
              fulfillmentLineItem {
                lineItem {
                  sku
                  title
                  variant { id title }
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                  discountedUnitPriceSet { shopMoney { amount currencyCode } }
                }
              }
            }
          }
        }
        exchangeLineItems: exchangeLineItems(first: 25) {
          nodes {
            id
            quantity
            variant {
              id
              sku
              title
              price
            }
          }
        }
        order {
          id
          name
          email
          customer {
            firstName
            lastName
            email
            phone
          }
          shippingAddress {
            address1
            address2
            city
            province
            zip
            country
            phone
          }
        }
      }
    }
  `;
  const data = await shopifyGraphQL(query, { id: returnGid });
  return data.return;
}

/** Add an internal note to the order so staff can see automation progress in Shopify */
async function addOrderNote(orderGid, note) {
  const mutation = `
    mutation OrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id }
        userErrors { field message }
      }
    }
  `;
  await shopifyGraphQL(mutation, { input: { id: orderGid, note } });
}

module.exports = { getReturnDetails, addOrderNote };
