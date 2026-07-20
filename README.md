# Returns & Exchange Automation

Automates your Shopify → BobGo → Unleashed return/exchange process:

1. Customer requests a return/exchange in Shopify.
2. This app books the collection waybill in BobGo and emails it to the customer automatically.
3. It creates the Credit Note in Unleashed against the original Sales Order.
4. If it's an exchange, it creates the new Sales Order in Unleashed with status `Placed`, ready for the warehouse to pick.

## 1. Local setup

```bash
cd returns-automation
npm install
cp .env.example .env
# fill in .env with your real credentials
npm run dev
```

## 2. Fill in `.env`

- **Shopify**: create a custom app in your Shopify admin (Settings → Apps → Develop apps), grant `read_orders`, `read_returns`, `write_orders` scopes, and generate an Admin API access token.
- **BobGo**: your existing Bearer token from BobGo settings.
- **Unleashed**: your existing API ID + API Key from Unleashed (Settings → API Access).
- **SMTP**: any provider (Gmail app password, SendGrid, etc.) for sending the waybill email.

## 3. Deploy to Render

1. Push this folder to a GitHub repo.
2. In Render: New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add every variable from `.env` under Render's **Environment** tab (never commit your real `.env`).
5. Deploy — Render will give you a live URL like `https://your-app.onrender.com`.

## 4. Register the Shopify webhook

In your Shopify custom app, subscribe to the `RETURNS_REQUEST` (GraphQL topic `returns/request`) webhook, pointing to:

```
https://your-app.onrender.com/webhooks/returns-request
```

You can do this via the GraphQL Admin API (`webhookSubscriptionCreate`) or, if using an app config file, in `shopify.app.toml`.

## 5. Before going live — confirm these two things

The scaffold makes two assumptions you should verify and adjust in `services/unleashed.js`:

- **Order matching**: `findSalesOrderByNumber` currently strips the `#` from the Shopify order name (e.g. `#1234` → `1234`) and looks for that as the Unleashed `OrderNumber`. Confirm this matches how your two systems are actually linked.
- **Pricing on credit/exchange lines**: unit prices are currently placeholders (`0`). You'll want to pull the real price either from the original Shopify line item (for credits) or from your Unleashed product catalog (for exchange items) so the Credit Note and new Sales Order carry the correct values.

## 6. Test end-to-end safely

- Use BobGo's **sandbox** environment first (`https://api.sandbox.bobgo.co.za/v2/`) so you don't book/pay for real shipments while testing.
- Use [webhook.site](https://webhook.site) to inspect the exact JSON Shopify sends for a `returns/request` event on your store before trusting the field names in `services/shopify.js` — Shopify's return/exchange payload structure has changed over API versions, so it's worth a quick sanity check with real data.
- Trigger a test return on a real (or duplicate test) order and confirm each step: waybill emailed → order note added → credit note appears in Unleashed → (if exchange) new sales order appears as `Placed`.

## What this doesn't do (yet)

- It doesn't wait for merchant approval — it acts as soon as the customer submits the return request. If you want a manual approval step first, subscribe to `returns/approve` instead of `returns/request`, and only trigger the automation once you've approved it in Shopify.
- It doesn't handle partial-failure cleanup (e.g. if BobGo succeeds but Unleashed fails). For your volume (<10/week) a Slack/email alert on any caught error is probably enough — add your alert of choice where the `TODO` comment is in `routes/webhooks.js`.
