require("dotenv").config();
const mongoose = require("mongoose");
const Facility = require("../models/Facility.model");
const QRCode = require("../models/QRCode.model");
const qrGenerator = require("../utils/qrGenerator");
const { sendEmail, buildDailyQREmail } = require("../utils/emailService");
const { refreshAccessCodesForFacility } = require("../services/facilityAccessCodeService");

const slugify = (str) =>
  String(str || "facility")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getValidityDays = () => {
  const parsed = parseInt(process.env.QR_VALIDITY_DAYS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
};

const QR_VALIDITY_MS = getValidityDays() * 24 * 60 * 60 * 1000;

const generateForFacility = async (facility) => {
  console.log(`\nGenerating QR codes for: ${facility.name}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const validFrom = new Date();
  const validUntil = new Date(validFrom.getTime() + QR_VALIDITY_MS - 1);
  const slug = slugify(facility.name);
  const today = new Date().toISOString().slice(0, 10);

  // Entry QR
  const entryQR = await qrGenerator.generateCompleteQRCode(
    "lock",
    facility._id,
    { location: "Main Entrance", type: "entry" },
    { qrCodeId: `${slug}_Entry_Code_${today}` }
  );

  const entryQRCode = await QRCode.create({
    qrCodeId: entryQR.qrCodeId,
    facilityId: facility._id,
    facilityName: facility.name,
    type: "entry",
    action: "lock",
    token: entryQR.token,
    url: entryQR.url,
    imagePath: entryQR.imagePath,
    metadata: { location: "Main Entrance", type: "entry" },
    validFrom,
    validUntil,
  });

  console.log("Entry QR Code generated");
  console.log(`ID: ${entryQRCode.qrCodeId}`);
  console.log(`Valid until: ${validUntil.toISOString()}\n`);

  // Exit QR
  const exitQR = await qrGenerator.generateCompleteQRCode(
    "unlock",
    facility._id,
    { location: "Main Exit", type: "exit" },
    { qrCodeId: `${slug}_Exit_Code_${today}` }
  );

  const exitQRCode = await QRCode.create({
    qrCodeId: exitQR.qrCodeId,
    facilityId: facility._id,
    facilityName: facility.name,
    type: "exit",
    action: "unlock",
    token: exitQR.token,
    url: exitQR.url,
    imagePath: exitQR.imagePath,
    metadata: { location: "Main Exit", type: "exit" },
    validFrom,
    validUntil,
  });

  console.log("Exit QR Code generated");
  console.log(`ID: ${exitQRCode.qrCodeId}`);
  console.log(`Valid until: ${validUntil.toISOString()}\n`);

  const accessCodes = await refreshAccessCodesForFacility(facility._id, new Date());
  console.log("6-digit access codes generated");
  console.log(`Entry code: ${accessCodes.entryCode}`);
  console.log(`Exit code: ${accessCodes.exitCode}`);
  console.log(`Code valid until: ${accessCodes.validUntil.toISOString()}\n`);

  // Send email with today's QR attachments if facility has notification emails
  if (facility.notificationEmails && facility.notificationEmails.length) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const html = buildDailyQREmail({
      facilityName: facility.name,
      date: dateStr,
    });

    try {
      await sendEmail({
        to: facility.notificationEmails,
        subject: `Daily QR ${facility.name} — ${dateStr} (manual run)`,
        html,
        attachments: [
          {
            filename: `ENTRY-${facility.name}-${dateStr}.png`,
            path: entryQRCode.imagePath,
          },
          {
            filename: `EXIT-${facility.name}-${dateStr}.png`,
            path: exitQRCode.imagePath,
          },
        ],
      });
      console.log(`Email sent to: ${facility.notificationEmails.join(", ")}`);
    } catch (emailErr) {
      console.error(
        `Failed to send email for ${facility.name}:`,
        emailErr.message
      );
    }
  } else {
    console.log("No notification emails configured; skipping email send.");
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("QR Codes generated successfully!");
  console.log("Check: ./uploads/qr-codes/\n");
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const arg = process.argv[2];

  // If "all" or no arg, generate for every facility
  if (!arg || arg.toLowerCase() === "all") {
    const facilities = await Facility.find({});
    if (!facilities.length) {
      console.error("No facilities found in database");
      process.exit(1);
    }
    for (const facility of facilities) {
      await generateForFacility(facility);
    }
    process.exit(0);
  }

  // Otherwise treat arg as facility _id or facilityId
  let facility = null;
  if (mongoose.Types.ObjectId.isValid(arg)) {
    facility = await Facility.findById(arg);
  }
  if (!facility) {
    facility = await Facility.findOne({ facilityId: arg });
  }

  if (!facility) {
    console.error("Facility not found");
    process.exit(1);
  }

  await generateForFacility(facility);
  process.exit(0);
};

main().catch((error) => {
  console.error("Error generating QR codes:", error);
  process.exit(1);
});
