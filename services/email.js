const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendWaybillEmail({ to, customerName, orderName, waybillUrl, trackingNumber, isExchange }) {
  const subject = isExchange
    ? `Your exchange for order ${orderName} - collection details`
    : `Your return for order ${orderName} - collection details`;

  const html = `
    <p>Hi ${customerName},</p>
    <p>Thanks for your ${isExchange ? "exchange" : "return"} request for order ${orderName}.</p>
    <p>Your courier waybill is ready. Please print it, attach it to your parcel, and it will be collected automatically.</p>
    <p><a href="${waybillUrl}" target="_blank">Download your waybill</a></p>
    ${trackingNumber ? `<p>Tracking number: ${trackingNumber}</p>` : ""}
    <p>Once we receive and check the item(s), we'll process your ${isExchange ? "exchange" : "refund"} right away.</p>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  });
}

module.exports = { sendWaybillEmail };
