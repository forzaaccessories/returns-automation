require("dotenv").config();
const express = require("express");
const app = express();
const SERVER_START_TIME = new Date().toISOString();

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

// Visit this URL right before testing to confirm your latest push is
// actually live - Render sets RENDER_GIT_COMMIT automatically, no setup needed.
app.get("/version", (req, res) => {
  res.json({
    commit: process.env.RENDER_GIT_COMMIT || "unknown (not running on Render)",
    deployedAt: process.env.RENDER_GIT_COMMIT ? undefined : "local",
    serverStartedAt: SERVER_START_TIME,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Returns automation server listening on port ${PORT}`);
});
