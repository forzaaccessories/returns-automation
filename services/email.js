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

async function sendPaymentLinkEmail({ to, customerName, orderName, paymentLink, amountRands }) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: `Payment needed to complete your exchange for order ${orderName}`,
    html: `
      <p>Hi ${customerName},</p>
      <p>Thanks for your exchange request for order ${orderName}. Since the replacement item costs a bit more, there's a small balance to settle before we can send it out.</p>
      <p><strong>Amount due: R${amountRands.toFixed(2)}</strong></p>
      <p><a href="${paymentLink}" target="_blank">Pay now to complete your exchange</a></p>
      <p>Once payment is received, we'll process your exchange right away.</p>
    `,
  });
}

module.exports = { sendWaybillEmail, sendPaymentLinkEmail };
