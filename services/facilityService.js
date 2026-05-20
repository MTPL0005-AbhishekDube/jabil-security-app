const mongoose = require("mongoose");
const Facility = require("../models/Facility.model");
const QRCode = require("../models/QRCode.model");
const Device = require("../models/Device.model");
const Enrollment = require("../models/Enrollment.model");
const ForceExitRequest = require("../models/ForceExitRequest.model");
const mdmService = require("../utils/mdmService");
const { ensureFreshQRCodes } = require("./qrRotationService");

// Find facility by Mongo _id
const findFacilityById = async (id, adminId = null) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const query = { _id: id };

  if (adminId) {
    query.createdBy = adminId;
  }

  let facility = await Facility.findOne(query);
  if (facility && facility.status === "active") {
    facility = await ensureFreshQRCodes(facility);
  }
  return facility;
};

// Build a public-facing URL for stored QR images
const buildQrImageUrl = (imagePath, req) => {
  if (!imagePath) return null;
  const normalized = imagePath.replace(/\\/g, "/");
  const qrCodeImagesIndex = normalized.lastIndexOf("qr-code-images");
  const relativePath =
    qrCodeImagesIndex !== -1
      ? normalized.slice(qrCodeImagesIndex)
      : normalized.replace(/^\.\/?/, "");
  return `${req.protocol}://${req.get("host")}/${relativePath.replace(
    /^\/?/,
    ""
  )}`;
};

// Attach active QR codes (entry/exit) to facilities
const attachActiveQRCodes = async (facilities, req) => {
  if (!facilities?.length) return [];

  const now = new Date();
  
  // Ensure each facility has fresh QR codes before attaching
  const freshFacilities = await Promise.all(
    facilities.map(async (f) => {
      if (f.status === "active") {
        return await ensureFreshQRCodes(f);
      }
      return f;
    })
  );

  const facilityIds = freshFacilities.map((f) => f._id);

  const qrs = await QRCode.find({
    facilityId: { $in: facilityIds },
    status: "active",
    validFrom: { $lte: now },
    validUntil: { $gte: now },
  })
    .sort({ type: 1 })
    .lean();

  const grouped = qrs.reduce((acc, qr) => {
    const key = qr.facilityId.toString();
    acc[key] = acc[key] || [];
    acc[key].push({
      id: qr._id,
      type: qr.type,
      action: qr.action,
      status: qr.status,
      validFrom: qr.validFrom,
      validUntil: qr.validUntil,
      generatedForDate: qr.generatedForDate,
      token: qr.token,
      url: qr.url,
      imagePath: qr.imagePath,
      imageUrl: buildQrImageUrl(qr.imagePath, req),
    });
    return acc;
  }, {});

  return freshFacilities.map((facility) => {
    const obj = facility.toObject ? facility.toObject() : { ...facility };
    obj.activeQRCodes = grouped[facility._id.toString()] || [];
    obj.qrNextRotationAt = facility.qrNextRotationAt; // Include qrNextRotationAt for frontend auto-refresh
    obj.accessCodes = {
      entryCode: obj.entryCode || null,
      entryCodeValidUntil: obj.entryCodeValidUntil || null,
      exitCode: obj.exitCode || null,
      exitCodeValidUntil: obj.exitCodeValidUntil || null,
    };
    return obj;
  });
};

// Unlock and detach any active devices for the facility, then remove enrollments
const detachDevicesAndEnrollments = async (facilityId) => {
  const activeEnrollments = await Enrollment.find({
    facilityId,
    status: "active",
  }).populate("deviceId");

  for (const enrollment of activeEnrollments) {
    const device = enrollment.deviceId;
    if (device) {
      // Best-effort unlock camera before detaching
      if (device.deviceId && device.deviceInfo?.platform) {
        try {
          await mdmService.unlockCamera(
            device.deviceId,
            device.deviceInfo.platform
          );
        } catch (err) {
          console.error(
            `Failed to unlock device ${device.deviceId} while deleting facility ${facilityId}:`,
            err.message
          );
        }
      }

      device.status = "inactive";
      device.currentFacility = null;
      device.lastEnrollment = null;
      device.updatedAt = new Date();
      await device.save();
    }

    enrollment.status = "expired";
    enrollment.unenrolledAt = new Date();
    await enrollment.save();

    // Clean up any force exit requests for this device
    await ForceExitRequest.deleteMany({ deviceId: device?._id });
  }

  // Detach any devices still pointing to this facility (even if not in active enrollment)
  await Device.updateMany(
    { currentFacility: facilityId },
    {
      $set: {
        status: "inactive",
        currentFacility: null,
        lastEnrollment: null,
        updatedAt: new Date(),
      },
    }
  );

  // Remove all enrollments (active and historical) for this facility
  await Enrollment.deleteMany({ facilityId });
};

module.exports = {
  findFacilityById,
  buildQrImageUrl,
  attachActiveQRCodes,
  detachDevicesAndEnrollments,
};
