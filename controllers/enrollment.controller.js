const Enrollment = require("../models/Enrollment.model");
const Device = require("../models/Device.model");
const QRCode = require("../models/QRCode.model");
const mdmService = require("../utils/mdmService");
const { verifyToken, verifyRestoreToken } = require("../utils/jwt");
const { v4: uuidv4 } = require("uuid");
const { generateNextVisitorId } = require("../utils/visitorId");

// Normalize incoming token:
// - Strip surrounding braces
// - If a deep link like security-app://enroll?...&token=JWT, extract the token param
const normalizeToken = (rawToken) => {
  if (!rawToken) return null;
  let t = String(rawToken).trim();
  t = t.replace(/^[{]/, "").replace(/[}]$/, ""); // remove stray braces

  if (t.includes("token=")) {
    // Attempt URL parse first
    try {
      const url = new URL(t);
      const param = url.searchParams.get("token");
      if (param) t = param;
    } catch (err) {
      // Fallback manual parse for custom schemes
      const idx = t.indexOf("token=");
      if (idx >= 0) {
        t = t.slice(idx + "token=".length);
        const amp = t.indexOf("&");
        if (amp >= 0) t = t.slice(0, amp);
      }
    }
  }
  return t;
};

// @desc    Scan entry QR and enroll device (lock camera)
// @route   POST /api/enrollments/scan-entry
exports.scanEntry = async (req, res) => {
  try {
    const { token, deviceId, deviceInfo } = req.body;
    const pushToken = deviceInfo?.pushToken;

    // Normalize token in case mobile passes deep link URL
    const normalizedToken = normalizeToken(token);

    // Validate required fields
    if (!normalizedToken || !deviceId || !deviceInfo) {
      return res.status(400).json({
        status: "error",
        message: "Token, deviceId, and deviceInfo are required",
      });
    }

    // Verify token (JWT). If it fails, try fallback lookup by raw token value.
    let decoded;
    let qrCode;
    try {
      decoded = verifyToken(normalizedToken);
      qrCode = await QRCode.findOne({ qrCodeId: decoded.qrCodeId }).populate(
        "facilityId"
      );
    } catch (error) {
      // Fallback: token might already be the stored token string (e.g., older QR flow)
      qrCode = await QRCode.findOne({ token: normalizedToken }).populate(
        "facilityId"
      );
      if (qrCode) {
        decoded = { qrCodeId: qrCode.qrCodeId };
      } else {
        return res.status(400).json({
          status: "error",
          message: "Invalid or expired token",
        });
      }
    }

    if (!qrCode || !qrCode.isValid()) {
      return res.status(400).json({
        status: "error",
        message: "Invalid or expired QR code",
      });
    }

    // Check if it's an entry QR
    if (qrCode.type !== "entry") {
      return res.status(400).json({
        status: "error",
        message: "This QR code is not for entry",
      });
    }

    // Find or create device
    let device = await Device.findOne({ deviceId });

    if (!device) {
      device = await Device.create({
        deviceId,
        deviceInfo,
        status: "inactive",
        pushToken,
        visitorId: await generateNextVisitorId(),
      });
    } else {
      // Update device info
      device.deviceInfo = deviceInfo;
      if (pushToken) device.pushToken = pushToken;
      if (!device.visitorId) {
        device.visitorId = await generateNextVisitorId();
      }
      await device.save();
    }

    // Check if device is already enrolled (double entry)
    const existingEnrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: "active",
    });

    if (existingEnrollment) {
      // EDGE CASE 1: Device is already enrolled in the SAME facility
      // Action: Return 200 OK (Idempotent success) but do not create new enrollment
      if (
        existingEnrollment.facilityId.toString() ===
        qrCode.facilityId._id.toString()
      ) {
        // Re-send lock command just in case
        await mdmService.lockCamera(deviceId, deviceInfo.platform);

        return res.status(200).json({
          status: "success",
          message: "Device is already enrolled. Camera locked.",
          data: {
            enrollmentId: existingEnrollment.enrollmentId,
            facilityName: qrCode.facilityId.name,
            visitorId: device.visitorId,
            action: "LOCK_CAMERA",
          },
        });
      }

      // EDGE CASE 2: Device is enrolled in a DIFFERENT facility
      // Action: Return 409 Conflict
      return res.status(409).json({
        status: "error",
        message:
          "Device is already enrolled in another facility. Please scan exit there first.",
      });
    }

    // Enroll device with MDM (Lock Camera)
    const lockResult = await mdmService.lockCamera(
      deviceId,
      deviceInfo.platform
    );

    if (!lockResult.success) {
      return res.status(500).json({
        status: "error",
        message: "Failed to lock camera",
        error: lockResult.error,
      });
    }

    // Reuse existing enrollment record for this device (single entry per device)
    let enrollment = await Enrollment.findOne({ deviceId: device._id }).sort({
      createdAt: -1,
    });

    if (!enrollment) {
      enrollment = new Enrollment({
        enrollmentId: uuidv4(),
        deviceId: device._id,
      });
    }

    enrollment.facilityId = qrCode.facilityId._id;
    enrollment.entryQRCode = qrCode._id;
    enrollment.exitQRCode = null;
    enrollment.status = "active";
    enrollment.enrolledAt = new Date();
    enrollment.unenrolledAt = null;
    enrollment.reason = undefined;
    enrollment.initiatedBy = undefined;
    await enrollment.save();

    // Update device status
    device.status = "active";
    device.currentFacility = qrCode.facilityId._id;
    device.lastEnrollment = enrollment._id;
    await device.save();

    // Record scan on QR code
    await qrCode.recordScan();

    // Return response in requested format
    res.status(200).json({
      status: "success",
      message: "Entry allowed",
      data: {
        enrollmentId: enrollment.enrollmentId,
        facilityName: qrCode.facilityId.name,
        visitorId: device.visitorId,
        action: "LOCK_CAMERA",
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Scan exit QR and unenroll device (unlock camera)
// @route   POST /api/enrollments/scan-exit
exports.scanExit = async (req, res) => {
  try {
    const { token, deviceId } = req.body;

    // Need deviceId and QR token (user flow)
    if (!deviceId || !token) {
      return res.status(400).json({
        status: "error",
        message: "Token and deviceId are required",
      });
    }

    // Verify token (JWT). If verification fails, try raw token lookup.
    let decoded;
    let qrCode;
    const normalizedToken = normalizeToken(token);

    if (!normalizedToken) {
      return res.status(400).json({
        status: "error",
        message: "Token and deviceId are required",
      });
    }

    try {
      decoded = verifyToken(normalizedToken);
      qrCode = await QRCode.findOne({ qrCodeId: decoded.qrCodeId }).populate(
        "facilityId"
      );
    } catch (error) {
      qrCode = await QRCode.findOne({ token: normalizedToken }).populate(
        "facilityId"
      );
      if (qrCode) {
        decoded = { qrCodeId: qrCode.qrCodeId };
      } else {
        return res.status(400).json({
          status: "error",
          message: "Invalid or expired token",
        });
      }
    }

    if (!qrCode || !qrCode.isValid()) {
      return res.status(400).json({
        status: "error",
        message: "Invalid or expired QR code",
      });
    }

    // Check if it's an exit QR
    if (qrCode.type !== "exit") {
      return res.status(400).json({
        status: "error",
        message: "This QR code is not for exit",
      });
    }

    // Find device
    const device = await Device.findOne({ deviceId });

    if (!device) {
      return res.status(404).json({
        status: "error",
        message: "Device not found",
      });
    }

    // Find active enrollment
    const enrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: "active",
    });

    if (!enrollment) {
      return res.status(404).json({
        status: "error",
        message: "No active enrollment for this device",
      });
    }

    if (
      !qrCode.facilityId ||
      enrollment.facilityId.toString() !== qrCode.facilityId._id.toString()
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "Exit QR belongs to a different facility. Please scan the exit QR for your current enrollment.",
      });
    }

    // Unlock camera (skip if already forced exit in past)
    const unlockResult = await mdmService.unlockCamera(
      deviceId,
      device.deviceInfo.platform
    );

    if (!unlockResult.success) {
      return res.status(500).json({
        status: "error",
        message: "Failed to unlock camera",
        error: unlockResult.error,
      });
    }

    // Update enrollment
    enrollment.status = "completed";
    enrollment.unenrolledAt = new Date();
    enrollment.exitQRCode = qrCode._id;
    await enrollment.save();

    // Update device status
    device.status = "inactive";
    device.currentFacility = null;
    device.lastEnrollment = enrollment._id;
    await device.save();

    // Record scan
    await qrCode.recordScan();

    // Return response in requested format
    res.status(200).json({
      status: "success",
      message: "Exit allowed",
      data: {
        action: "UNLOCK_CAMERA",
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Visitor taps push to restore permissions (idempotent)
// @route   POST /api/enrollments/restore-from-push
exports.restoreFromPush = async (req, res) => {
  try {
    const { token, deviceId } = req.body;

    if (!token || !deviceId) {
      return res.status(400).json({
        status: "error",
        message: "token and deviceId are required",
      });
    }

    let decoded;
    try {
      decoded = verifyRestoreToken(token);
    } catch (err) {
      return res.status(400).json({
        status: "error",
        message: "Invalid or expired token",
      });
    }

    if (decoded.deviceId !== deviceId) {
      return res.status(400).json({
        status: "error",
        message: "Token does not match device",
      });
    }

    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({
        status: "error",
        message: "Device not found",
      });
    }

    // Best-effort unlock
    await mdmService.unlockCamera(deviceId, device.deviceInfo.platform);

    // Close any active enrollment
    const enrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: "active",
    });

    if (enrollment) {
      enrollment.status = "forced_exit";
      enrollment.unenrolledAt = new Date();
      enrollment.exitQRCode = enrollment.exitQRCode || null;
      await enrollment.save();
      device.lastEnrollment = enrollment._id;
    }

    device.status = "inactive";
    device.currentFacility = null;
    await device.save();

    return res.status(200).json({
      status: "success",
      message: "Permissions restored",
      data: { action: "UNLOCK_CAMERA" },
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
