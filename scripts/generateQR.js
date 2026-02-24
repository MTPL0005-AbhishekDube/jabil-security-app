require("dotenv").config();
const mongoose = require("mongoose");
const Facility = require("../models/Facility.model");
const QRCode = require("../models/QRCode.model");
const qrGenerator = require("../utils/qrGenerator");

const slugify = (str) =>
  String(str || "facility")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const generateForFacility = async (facility) => {
  console.log(`\nGenerating QR codes for: ${facility.name}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Set validity period (30 days)
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);
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
    validUntil,
  });

  console.log("Entry QR Code generated");
  console.log(`ID: ${entryQRCode.qrCodeId}`);
  console.log(`Image: ${entryQRCode.imagePath}`);
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
    validUntil,
  });

  console.log("Exit QR Code generated");
  console.log(`ID: ${exitQRCode.qrCodeId}`);
  console.log(`Image: ${exitQRCode.imagePath}`);
  console.log(`Valid until: ${validUntil.toISOString()}\n`);

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
