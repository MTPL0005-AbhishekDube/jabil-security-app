const nodemailer = require("nodemailer");

// Simple reusable transporter using SMTP credentials from env
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Send email with attachments
exports.sendEmail = async ({ to, subject, html, attachments = [] }) => {
  if (!to || to.length === 0) {
    throw new Error("Recipient list is empty");
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    attachments,
  };

  return transporter.sendMail(mailOptions);
};

// Build a standard QR notification email (attachments carry the QR images)
exports.buildDailyQREmail = ({ facilityName, date }) => {
  return `
    <p>Hello Team,</p>

    <p>Please find attached the daily visitor QR codes for <strong>${facilityName}</strong> dated <strong>${date}</strong>.</p>

    <p>Kindly ensure the following:</p>
    <ul>
      <li>Use the <strong>ENTRY</strong> QR code at the entry gate.</li>
      <li>Use the <strong>EXIT</strong> QR code at the exit gate.</li>
      <li>Remove and replace any previous QR codes with today's codes to avoid confusion.</li>
    </ul>

    <p>If any QR code appears unclear, please download it again from this email instead of using a previous version.</p>

    <p>Thank you for your cooperation.</p>

    <p>Regards,<br/>CamBlock Automation Team</p>
  `;
};
