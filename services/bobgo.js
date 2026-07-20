const fetch = require("node-fetch");

const BASE_URL = process.env.BOBGO_BASE_URL || "https://api.bobgo.co.za/v2";
const TOKEN = process.env.BOBGO_BEARER_TOKEN;

async function bobgoRequest(path, method = "GET", body = null) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`BobGo API error (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * Books a collection from the customer's address to your warehouse
 * (i.e. the reverse of a normal delivery), and returns the shipment
 * including its waybill/label URL.
 *
 * NOTE: Confirm exact field names against your BobGo account in the
 * sandbox (https://api.sandbox.bobgo.co.za/v2/) before going live —
 * parcel/rate fields can vary depending on which couriers you have enabled.
 */
async function bookReturnCollection({ customer, address, parcels, reference }) {
  const shipmentPayload = {
    collection_address: {
      company: `${customer.firstName} ${customer.lastName}`.trim(),
      street_address: address.address1,
      local_area: address.address2 || "",
      city: address.city,
      zone: address.province,
      code: address.zip,
      country: address.country,
      phone: address.phone || customer.phone || "",
    },
    delivery_address: {
      company: process.env.WAREHOUSE_NAME,
      street_address: process.env.WAREHOUSE_ADDRESS_1,
      local_area: process.env.WAREHOUSE_ADDRESS_2 || "",
      city: process.env.WAREHOUSE_CITY,
      zone: process.env.WAREHOUSE_ZONE,
      code: process.env.WAREHOUSE_ZIP,
      country: process.env.WAREHOUSE_COUNTRY,
      phone: process.env.WAREHOUSE_PHONE,
    },
    parcels: parcels && parcels.length
      ? parcels
      : [{ parcel_description: "Return/exchange parcel", submitted_length_cm: 30, submitted_width_cm: 20, submitted_height_cm: 10, submitted_weight_kg: 1 }],
    reference,
    instruction: "customer_collection", // collect FROM customer
  };

  // 1. Get a rate/quote
  const rates = await bobgoRequest("/rates", "POST", shipmentPayload);
  const cheapestRate = rates.rates?.[0];
  if (!cheapestRate) throw new Error("BobGo returned no rates for this collection.");

  // 2. Book the shipment using the chosen rate
  const shipment = await bobgoRequest("/shipments", "POST", {
    ...shipmentPayload,
    rate_id: cheapestRate.rate_id,
  });

  return {
    shipmentId: shipment.id,
    trackingNumber: shipment.tracking_number,
    waybillUrl: shipment.waybill_document_url || shipment.label_url,
  };
}

module.exports = { bookReturnCollection };
