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
async function bookReturnCollection({ customer, address, parcels, reference, customerEmail }) {
  const customerPhone = address.phone || customer.phone || "";
  const shipmentPayload = {
    collection_address: {
      contact_name: `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "Customer",
      company: `${customer.firstName} ${customer.lastName}`.trim(),
      street_address: address.address1,
      local_area: address.address2 || "",
      city: address.city,
      zone: address.province,
      code: address.zip,
      country: address.country,
      phone: customerPhone,
      contact_number: customerPhone,
      contact_email: customerEmail || "",
    },
    delivery_address: {
      contact_name: process.env.WAREHOUSE_NAME || "Warehouse",
      company: process.env.WAREHOUSE_NAME,
      street_address: process.env.WAREHOUSE_ADDRESS_1,
      local_area: process.env.WAREHOUSE_ADDRESS_2 || "",
      city: process.env.WAREHOUSE_CITY,
      zone: process.env.WAREHOUSE_ZONE,
      code: process.env.WAREHOUSE_ZIP,
      country: process.env.WAREHOUSE_COUNTRY,
      phone: process.env.WAREHOUSE_PHONE,
      contact_number: process.env.WAREHOUSE_PHONE,
      contact_email: process.env.WAREHOUSE_EMAIL || "",
    },
    parcels: parcels && parcels.length
      ? parcels
      : [{ parcel_description: "Return/exchange parcel", submitted_length_cm: 30, submitted_width_cm: 20, submitted_height_cm: 10, submitted_weight_kg: 1, declared_value: 500 }],
    reference,
    instruction: "customer_collection", // collect FROM customer
  };

  // 1. Get a rate/quote
  console.log("BobGo /rates request payload:", JSON.stringify(shipmentPayload));
  const ratesResponse = await bobgoRequest("/rates", "POST", shipmentPayload);
  console.log("BobGo /rates raw response:", JSON.stringify(ratesResponse));

  // BobGo nests rates per courier: provider_rate_requests[].responses[]
  const allRates = (ratesResponse.provider_rate_requests || [])
    .filter((provider) => provider.status === "success")
    .flatMap((provider) =>
      (provider.responses || [])
        .filter((r) => r.status === "success")
        .map((r) => ({
          provider_slug: provider.provider_slug,
          provider_name: provider.provider_name,
          service_level_code: r.service_level_code,
          rate_amount: r.rate_amount, // VAT-inclusive, what you're actually charged
        }))
    );

  if (!allRates.length) {
    throw new Error(`BobGo returned no usable rates for this collection. Full response: ${JSON.stringify(ratesResponse)}`);
  }

  // Always pick the cheapest available rate across every courier.
  const cheapestRate = [...allRates].sort((a, b) => a.rate_amount - b.rate_amount)[0];
  console.log("Cheapest BobGo rate selected:", JSON.stringify(cheapestRate));

  // 2. Book the shipment using the chosen rate.
  // NOTE: I'm constructing this from the fields BobGo's /rates response
  // actually returned (the rates request `id`, plus the chosen courier's
  // provider_slug + service_level_code). I don't have confirmation this
  // exact shape is what /shipments expects - if this call errors, the
  // full error response will tell us what field name it actually wants.
  const shipmentBookingPayload = {
    collection_address: {
      company: shipmentPayload.collection_address.company,
      street_address: shipmentPayload.collection_address.street_address,
      local_area: shipmentPayload.collection_address.local_area,
      city: shipmentPayload.collection_address.city,
      zone: shipmentPayload.collection_address.zone,
      code: shipmentPayload.collection_address.code,
      country: shipmentPayload.collection_address.country,
    },
    collection_contact_name: shipmentPayload.collection_address.contact_name,
    collection_contact_number: shipmentPayload.collection_address.contact_number,
    collection_contact_email: shipmentPayload.collection_address.contact_email,
    delivery_address: {
      company: shipmentPayload.delivery_address.company,
      street_address: shipmentPayload.delivery_address.street_address,
      local_area: shipmentPayload.delivery_address.local_area,
      city: shipmentPayload.delivery_address.city,
      zone: shipmentPayload.delivery_address.zone,
      code: shipmentPayload.delivery_address.code,
      country: shipmentPayload.delivery_address.country,
    },
    delivery_contact_name: shipmentPayload.delivery_address.contact_name,
    delivery_contact_number: shipmentPayload.delivery_address.contact_number,
    delivery_contact_email: shipmentPayload.delivery_address.contact_email,
    parcels: shipmentPayload.parcels,
    reference,
    instruction: "customer_collection",
    rate_id: ratesResponse.id,
    provider_slug: cheapestRate.provider_slug,
    service_level_code: cheapestRate.service_level_code,
  };
  console.log("BobGo /shipments request payload:", JSON.stringify(shipmentBookingPayload));
  const shipment = await bobgoRequest("/shipments", "POST", shipmentBookingPayload);
  console.log("BobGo /shipments raw response:", JSON.stringify(shipment));

  // 3. BobGo generates the actual waybill/label asynchronously after
  // booking (note "submission_status":"pending-rates" on the initial
  // response) - poll briefly until it's ready, rather than assuming
  // it's available instantly.
  const waybillUrl = await pollForWaybillDocument(shipment.id);

  return {
    shipmentId: shipment.id,
    trackingNumber: shipment.tracking_reference,
    waybillUrl,
  };
}

/**
 * Polls GET /shipments/{id} until a waybill/label document URL appears,
 * or gives up after ~30 seconds. I don't yet have confirmation of the
 * exact field name BobGo uses for the ready document, so this checks a
 * few plausible ones - if this keeps failing, the logged raw response
 * on each attempt will show us the real field name to use instead.
 */
async function pollForWaybillDocument(shipmentId, attempts = 8, delayMs = 4000) {
  for (let i = 0; i < attempts; i++) {
    const shipment = await bobgoRequest(`/shipments/${shipmentId}`, "GET");
    console.log(`BobGo shipment poll attempt ${i + 1}:`, JSON.stringify(shipment));

    const candidateUrl =
      shipment.waybill_document_url ||
      shipment.label_url ||
      shipment.document_url ||
      shipment.provider_document_url ||
      shipment.tracking_document_url ||
      shipment.waybill_url;

    if (candidateUrl) {
      return candidateUrl;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  console.error(`No waybill document found for BobGo shipment ${shipmentId} after polling - continuing without it.`);
  return null;
}

module.exports = { bookReturnCollection };
