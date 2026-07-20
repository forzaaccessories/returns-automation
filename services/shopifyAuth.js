const fetch = require("node-fetch");

const STORE = process.env.SHOPIFY_STORE;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

let cachedToken = null;
let expiresAt = 0; // epoch ms

/**
 * Shopify's client-credentials grant issues access tokens that expire
 * after ~24 hours. This fetches a fresh one on first use and re-uses it
 * until shortly before it expires, then transparently refreshes.
 * Docs: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < expiresAt) {
    return cachedToken;
  }

  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to get Shopify access token: ${JSON.stringify(json)}`);
  }

  cachedToken = json.access_token;
  // Refresh 5 minutes before actual expiry, to be safe.
  expiresAt = Date.now() + (json.expires_in - 300) * 1000;
  return cachedToken;
}

module.exports = { getAccessToken };
