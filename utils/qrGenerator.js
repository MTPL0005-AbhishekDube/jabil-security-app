const QRCode = require("qrcode");
const fs = require("fs").promises;
const path = require("path");
const { generateQRToken } = require("./jwt");

const mongoose = require("mongoose");

// Generate QR code data
exports.generateQRData = (action, facilityId, metadata = {}, idOverride) => {
  const id = idOverride || new mongoose.Types.ObjectId();

  const payload = {
    id,
    action, // 'lock' or 'unlock'
    facilityId,
    ...metadata,
    createdAt: new Date().toISOString(),
  };

  const token = generateQRToken(payload);

  return {
    id,
    token,
    payload,
  };
};

// Generate QR code URL
exports.generateQRURL = (token, action) => {
  const deepLinkScheme = process.env.DEEP_LINK_SCHEME;

  // Create deep link URL
  return `${deepLinkScheme}enroll?action=${action}&token=${token}`;
};

// Generate QR code image
exports.generateQRImage = async (data, options = {}) => {
  const defaultOptions = {
    errorCorrectionLevel: "H",
    type: "image/png",
    quality: 0.95,
    margin: 2,
    width: 400,
    color: {
      dark: "#000000",
      light: "#FFFFFF",
    },
  };

  const qrOptions = { ...defaultOptions, ...options };

  try {
    // Generate QR code as buffer
    const qrBuffer = await QRCode.toBuffer(data, qrOptions);
    return qrBuffer;
  } catch (error) {
    throw new Error(`Failed to generate QR code: ${error.message}`);
  }
};

// Save QR code image to file
exports.saveQRImage = async (
  data,
  filename,
  outputDir = "./qr-code-images"
) => {
  try {
    // Ensure directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Generate QR code
    const qrBuffer = await this.generateQRImage(data);

    // Create file path
    const filePath = path.join(outputDir, filename);

    // Save to file
    await fs.writeFile(filePath, qrBuffer);

    return filePath;
  } catch (error) {
    throw new Error(`Failed to save QR code: ${error.message}`);
  }
};

// Generate complete QR code (data + image)
exports.generateCompleteQRCode = async (
  action,
  facilityId,
  metadata = {},
  options = {}
) => {
  try {
    // Generate QR data
    const qrData = this.generateQRData(
      action,
      facilityId,
      metadata,
      options.id
    );

    // Build deep link URL (kept for reference/clients that want it)
    const deepLink = this.generateQRURL(qrData.token, action);
    // Decide what to actually encode into the QR image:
    // - default: just the raw token (simpler for clients that expect token-only)
    // - opt-in: set QR_ENCODE_MODE=deeplink to embed the deep link instead
    const encodeMode =
      process.env.QR_ENCODE_MODE === "deeplink" ? "deeplink" : "token";
    const qrContent = encodeMode === "deeplink" ? deepLink : qrData.token;

    // Generate filename with facility name and date
    const facilityName = metadata.location || "facility";
    const typeLabel = metadata.type === "entry" ? "Entry_Code" : "Exit_Code";
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sanitizedFacilityName = facilityName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const filename = `${sanitizedFacilityName}_${typeLabel}_${date}.png`;

    const imagePath = await this.saveQRImage(qrContent, filename);

    return {
      id: qrData.id,
      token: qrData.token,
      url: deepLink, // deep link preserved for clients that need it
      encoded: qrContent, // what was actually embedded in the QR image
      imagePath,
      payload: qrData.payload,
    };
  } catch (error) {
    throw new Error(`Failed to generate complete QR code: ${error.message}`);
  }
};

// Generate QR code as base64
exports.generateQRBase64 = async (data, options = {}) => {
  try {
    const qrDataURL = await QRCode.toDataURL(data, {
      errorCorrectionLevel: "H",
      type: "image/png",
      quality: 0.95,
      margin: 2,
      width: 400,
      ...options,
    });

    return qrDataURL;
  } catch (error) {
    throw new Error(`Failed to generate QR code base64: ${error.message}`);
  }
};
