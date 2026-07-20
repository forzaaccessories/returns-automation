require("dotenv").config();

function mask(value) {
  if (!value) return "MISSING";
  if (value.length <= 6) return "***(too short to mask safely)";
  return value.slice(0, 4) + "..." + value.slice(-4) + ` (length: ${value.length})`;
}

console.log("SHOPIFY_STORE:", process.env.SHOPIFY_STORE || "MISSING");
console.log("SHOPIFY_CLIENT_ID:", mask(process.env.SHOPIFY_CLIENT_ID));
console.log("SHOPIFY_CLIENT_SECRET:", mask(process.env.SHOPIFY_CLIENT_SECRET));
