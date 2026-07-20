require("dotenv").config();
const express = require("express");
const app = express();

const webhookRoutes = require("./routes/webhooks");

// Webhook route needs the RAW body (for HMAC verification), so mount
// express.raw() ONLY for this path, before any express.json() middleware.
app.use("/webhooks", express.raw({ type: "application/json" }), webhookRoutes);

// Everything else can use normal JSON parsing
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Returns automation is running.");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Returns automation server listening on port ${PORT}`);
});
