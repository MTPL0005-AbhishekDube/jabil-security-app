const mongoose = require("mongoose");
const Enrollment = require("../models/Enrollment.model");
const Device = require("../models/Device.model");
const QRCode = require("../models/QRCode.model");
const mdmService = require("../utils/mdmService");
const { verifyToken } = require("../utils/jwt");
const { generateNextVisitorId } = require("../utils/visitorId");
const { findFacilityById } = require("../services/facilityService");
const { findValidAccessCode } = require("../services/facilityAccessCodeService");
const logger = require("../utils/logger");

// Normalize incoming token:
// - Strip surrounding braces
// - If a deep link like CamBlock-app://enroll?...&token=JWT, extract the token param
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

const normalizeSixDigitCode = (rawCode) => {
  if (rawCode === null || rawCode === undefined) return null;

  if (
    typeof rawCode === "number" &&
    Number.isInteger(rawCode) &&
    rawCode >= 0 &&
    rawCode <= 999999
  ) {
    return String(rawCode).padStart(6, "0");
  }

  const normalized = String(rawCode).trim();
  if (!/^\d{6}$/.test(normalized)) return null;
  return normalized;
};

// @desc    Scan exit using 6-digit exit code + facility
// @route   POST /api/enrollments/scan-exit-code
exports.scanExitByCode = async (req, res) => {
  const requestId = req.requestId || new mongoose.Types.ObjectId();
  const { deviceId, facilityId, exitCode } = req.body;

  logger.info("Scan exit by code request received", {
    requestId,
    deviceId,
    facilityId,
    hasExitCode: exitCode !== undefined && exitCode !== null,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });

  try {
    if (!deviceId || !facilityId || exitCode === undefined || exitCode === null) {
      return res.status(400).json({
        status: "error",
        message: "deviceId, facilityId, and exitCode are required",
      });
    }

    const normalizedExitCode = normalizeSixDigitCode(exitCode);
    if (!normalizedExitCode) {
      return res.status(400).json({
        status: "error",
        message: "exitCode must be a valid 6-digit code",
      });
    }

    const facility = await findFacilityById(facilityId);
    if (!facility || facility.status !== "active") {
      const error = "Facility is currently inactive. Scan not allowed.";
      logger.warn(error, {
        requestId,
        facilityId,
        facilityStatus: facility?.status,
      });

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    const now = new Date();
    const validExitCode = await findValidAccessCode({
      facilityId: facility._id,
      type: "exit",
      code: normalizedExitCode,
      referenceDate: now,
    });

    if (!validExitCode) {
      logger.warn("Invalid or expired exit code", {
        requestId,
        deviceId,
        facilityId: facility._id,
      });

      return res.status(400).json({
        status: "error",
        message: "Invalid or expired exit code",
      });
    }

    const exitQrCode = await QRCode.findOne({
      facilityId: facility._id,
      type: "exit",
      status: "active",
      validFrom: { $lte: now },
      validUntil: { $gte: now },
    }).sort({ validUntil: -1 });

    if (!exitQrCode || !exitQrCode.isValid()) {
      logger.warn("No active exit QR available for facility", {
        requestId,
        facilityId: facility._id,
      });

      return res.status(400).json({
        status: "error",
        message: "Invalid or expired QR code",
      });
    }

    // Reuse existing scan-exit behavior so response and unlock logic remain identical.
    req.body.token = exitQrCode.token;
    return exports.scanExit(req, res);
  } catch (error) {
    logger.logQRError("exit_by_code", error, {
      requestId,
      deviceId,
      facilityId,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Scan entry QR and enroll device (lock camera)
// @route   POST /api/enrollments/scan-entry
exports.scanEntry = async (req, res) => {
  const requestId = req.requestId || new mongoose.Types.ObjectId();
  const { token, deviceId, deviceInfo } = req.body;
  const pushToken = deviceInfo?.pushToken;

  logger.info("Scan entry request received", {
    requestId,
    deviceId,
    hasToken: !!token,
    hasDeviceInfo: !!deviceInfo,
    platform: deviceInfo?.platform,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });

  try {
    // Normalize token in case mobile passes deep link URL
    const normalizedToken = normalizeToken(token);

    // Validate required fields
    if (!normalizedToken || !deviceId || !deviceInfo) {
      const error = "Token, deviceId, and deviceInfo are required";
      logger.warn("Validation failed", {
        requestId,
        error,
        hasToken: !!normalizedToken,
        hasDeviceId: !!deviceId,
        hasDeviceInfo: !!deviceInfo,
      });
      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Verify token (JWT). If it fails, try fallback lookup by raw token value.
    let decoded;
    let qrCode;

    logger.logQRScan("entry", {
      requestId,
      deviceId,
      token: normalizedToken,
      platform: deviceInfo?.platform,
    });

    try {
      decoded = verifyToken(normalizedToken);
      logger.debug("JWT token verified successfully", {
        requestId,
        id: decoded.id,
      });

      qrCode = await QRCode.findById(decoded.id).populate(
        "facilityId"
      );

      if (!qrCode) {
        logger.warn("QR Code not found after JWT verification", {
          requestId,
          id: decoded.id,
        });
      }
    } catch (error) {
      logger.warn("JWT verification failed, trying fallback lookup", {
        requestId,
        error: error.message,
        tokenLength: normalizedToken?.length,
      });

      // Fallback: token might already be the stored token string (e.g., older QR flow)
      qrCode = await QRCode.findOne({ token: normalizedToken }).populate(
        "facilityId"
      );

      if (qrCode) {
        decoded = { id: qrCode._id };
        logger.info("Fallback lookup successful", {
          requestId,
          id: qrCode._id,
          facilityId: qrCode.facilityId?._id,
        });
      } else {
        logger.logQRError("entry", error, {
          requestId,
          deviceId,
          token: normalizedToken,
          fallbackFailed: true,
        });

        return res.status(400).json({
          status: "error",
          message: "Invalid or expired token",
        });
      }
    }

    if (!qrCode || !qrCode.isValid()) {
      const error = "Invalid or expired QR code";
      logger.warn(error, {
        requestId,
        id: qrCode?._id,
        isValid: qrCode?.isValid(),
        facilityId: qrCode?.facilityId?._id,
        expiresAt: qrCode?.expiresAt,
      });

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Check if facility is active
    if (!qrCode.facilityId || qrCode.facilityId.status !== "active") {
      const error = "Facility is currently inactive. Scan not allowed.";
      logger.warn(error, {
        requestId,
        id: qrCode._id,
        facilityId: qrCode.facilityId?._id,
        facilityStatus: qrCode.facilityId?.status,
      });

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Check if it's an entry QR
    if (qrCode.type !== "entry") {
      const error = "This QR code is not for entry";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    let device = await Device.findOne({ deviceId });

    logger.debug("Device lookup result", {
      requestId,
      deviceId,
      deviceExists: !!device,
      currentStatus: device?.status,
      currentFacility: device?.currentFacility,
    });

    if (!device) {
      logger.info("Creating new device", {
        requestId,
        deviceId,
        platform: deviceInfo?.platform,
        hasPushToken: !!pushToken,
      });

      device = await Device.create({
        deviceId,
        deviceInfo,
        status: "inactive",
        pushToken,
      });

    } else {
      // Update device info
      const oldDeviceInfo = device.deviceInfo;
      const oldPushToken = device.pushToken;

      device.deviceInfo = deviceInfo;
      if (pushToken) device.pushToken = pushToken;
      await device.save();

      logger.info("Device updated", {
        requestId,
        deviceId,
        deviceInfoChanged:
          JSON.stringify(oldDeviceInfo) !== JSON.stringify(deviceInfo),
        pushTokenChanged: oldPushToken !== pushToken,
      });
    }

    // Check if device is already enrolled (double entry)
    const existingEnrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: "active",
    }).populate("facilityId");

    logger.debug("Checking existing enrollment", {
      requestId,
      deviceId,
      hasExistingEnrollment: !!existingEnrollment,
      existingFacility: existingEnrollment?.facilityId,
    });

    if (existingEnrollment) {
      // EDGE CASE 1: Device is already enrolled in the SAME facility
      // Action: Return 200 OK (Idempotent success) but do not create new enrollment
      if (String(existingEnrollment.facilityId._id || existingEnrollment.facilityId) === String(qrCode.facilityId._id)) {
        logger.info("Device already enrolled in this facility", {
          requestId,
          deviceId,
          facilityId: qrCode.facilityId._id,
          enrollmentId: existingEnrollment._id,
        });

        return res.status(200).json({
          status: "success",
          message: "Device already enrolled in this facility",
          data: {
            enrollment: existingEnrollment,
            visitorId: existingEnrollment.visitorId,
            action: "lock",
          },
        });
      }

      // EDGE CASE 2: Device is enrolled in a DIFFERENT facility
      // Action: Return 409 Conflict
      const error = `Device is already enrolled in another facility (${existingEnrollment.facilityId?.name || 'Unknown'}). Please scan exit there first.`;
      logger.warn("Device enrolled in different facility", {
        requestId,
        deviceId,
        currentFacility: existingEnrollment.facilityId,
        attemptedFacility: qrCode.facilityId._id,
      });

      return res.status(409).json({
        status: "error",
        message: error,
      });
    }

    // Assign or retrieve visitorId for this device in this facility
    let visitorId;
    const previousEnrollment = await Enrollment.findOne({
      deviceId: device._id,
      facilityId: qrCode.facilityId._id,
      visitorId: { $exists: true }
    }).sort({ createdAt: -1 });

    if (previousEnrollment) {
      visitorId = previousEnrollment.visitorId;
    } else {
      visitorId = await generateNextVisitorId(qrCode.facilityId._id);
    }

    // Lock camera via MDM
    try {
      await mdmService.lockCamera(deviceId, deviceInfo.platform);
      logger.info("MDM: Camera locked successfully", {
        requestId,
        deviceId,
        platform: deviceInfo.platform,
      });
    } catch (mdmError) {
      logger.error("MDM: Failed to lock camera", {
        requestId,
        deviceId,
        error: mdmError.message,
      });
      // Continue even if MDM fails? Usually yes, but we should log it.
      // Depending on requirements, you might want to return error here.
    }

    // Create enrollment record
    const enrollment = await Enrollment.create({
      deviceId: device._id,
      facilityId: qrCode.facilityId._id,
      visitorId: visitorId,
      entryQRCode: qrCode._id,
      status: "active",
    });

    // Update device status
    device.status = "active";
    device.currentFacility = qrCode.facilityId._id;
    device.lastEnrollment = enrollment._id;
    device.lastActivity = new Date();
    await device.save();

    logger.info("Enrollment completed successfully", {
      requestId,
      deviceId,
      facilityId: qrCode.facilityId._id,
      enrollmentId: enrollment._id,
      visitorId: enrollment.visitorId,
    });

    return res.status(201).json({
      status: "success",
      message: "Camera locked and enrollment created",
      data: {
        enrollment,
        visitorId: enrollment.visitorId,
        action: "lock",
      },
    });
  } catch (error) {
    logger.logQRError("entry", error, {
      requestId,
      deviceId,
      token,
      stack: error.stack,
    });

    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Scan exit QR and unenroll device (unlock camera)
// @route   POST /api/enrollments/scan-exit
exports.scanExit = async (req, res) => {
  const requestId = req.requestId || new mongoose.Types.ObjectId();
  const { token, deviceId } = req.body;

  logger.info("Scan exit request received", {
    requestId,
    deviceId,
    hasToken: !!token,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });

  try {
    // Need deviceId and QR token (user flow)
    if (!deviceId || !token) {
      const error = "Token and deviceId are required";
      logger.warn("Validation failed", {
        requestId,
        error,
        hasToken: !!token,
        hasDeviceId: !!deviceId,
      });

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Verify token (JWT). If verification fails, try raw token lookup.
    let decoded;
    let qrCode;
    const normalizedToken = normalizeToken(token);

    logger.logQRScan("exit", {
      requestId,
      deviceId,
      token: normalizedToken,
    });

    if (!normalizedToken) {
      const error = "Token and deviceId are required";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    try {
      decoded = verifyToken(normalizedToken);
      logger.debug("JWT token verified successfully", {
        requestId,
        id: decoded.id,
      });

      qrCode = await QRCode.findById(decoded.id).populate(
        "facilityId"
      );

      if (!qrCode) {
        logger.warn("QR Code not found after JWT verification", {
          requestId,
          id: decoded.id,
        });
      }
    } catch (error) {
      logger.warn("JWT verification failed, trying fallback lookup", {
        requestId,
        error: error.message,
        tokenLength: normalizedToken?.length,
      });

      // Fallback: token might already be the stored token string (e.g., older QR flow)
      qrCode = await QRCode.findOne({ token: normalizedToken }).populate(
        "facilityId"
      );

      if (qrCode) {
        decoded = { id: qrCode._id };
        logger.info("Fallback lookup successful", {
          requestId,
          id: qrCode._id,
          facilityId: qrCode.facilityId?._id,
        });
      } else {
        logger.logQRError("exit", error, {
          requestId,
          deviceId,
          token: normalizedToken,
          fallbackFailed: true,
        });

        return res.status(400).json({
          status: "error",
          message: "Invalid or expired token",
        });
      }
    }

    if (!qrCode || !qrCode.isValid()) {
      const error = "Invalid or expired QR code";
      logger.warn(error, {
        requestId,
        id: qrCode?._id,
        isValid: qrCode?.isValid(),
        facilityId: qrCode?.facilityId?._id,
        expiresAt: qrCode?.expiresAt,
      });

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Check if facility is active
    if (!qrCode.facilityId || qrCode.facilityId.status !== "active") {
      const error = "Facility is currently inactive. Scan not allowed.";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Check if it's an exit QR
    if (qrCode.type !== "exit") {
      const error = "This QR code is not for exit";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Find device
    const device = await Device.findOne({ deviceId });

    logger.debug("Device lookup result", {
      requestId,
      deviceId,
      deviceExists: !!device,
      currentStatus: device?.status,
      currentFacility: device?.currentFacility,
    });

    if (!device) {
      const error = "Device not found";
      logger.warn(error, {
        requestId,
        deviceId,
      });

      return res.status(404).json({
        status: "error",
        message: error,
      });
    }

    // Find active enrollment
    const enrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: "active",
    });

    logger.debug("Active enrollment lookup", {
      requestId,
      deviceId,
      hasActiveEnrollment: !!enrollment,
      enrollmentId: enrollment?._id,
      enrollmentFacility: enrollment?.facilityId,
    });

    if (!enrollment) {
      const error = "No active enrollment for this device";
      logger.warn(error, {
        requestId,
        deviceId,
        deviceStatus: device.status,
        currentFacility: device.currentFacility,
      });

      return res.status(404).json({
        status: "error",
        message: error,
      });
    }

    if (
      !qrCode.facilityId ||
      enrollment.facilityId.toString() !== qrCode.facilityId._id.toString()
    ) {
      const error =
        "Exit QR doesn't match this facility. Please scan the correct exit QR.";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Unlock camera (skip if already forced exit in past)
    logger.info("Attempting to unlock camera via MDM", {
      requestId,
      deviceId,
      platform: device.deviceInfo.platform,
      facilityId: qrCode.facilityId._id,
      enrollmentId: enrollment._id,
    });

    const unlockResult = await mdmService.unlockCamera(
      deviceId,
      device.deviceInfo.platform
    );

    logger.logMDMOperation(
      "unlockCamera",
      deviceId,
      device.deviceInfo.platform,
      unlockResult,
      {
        requestId,
        facilityId: qrCode.facilityId._id,
        facilityName: qrCode.facilityId.name,
        enrollmentId: enrollment._id,
      }
    );

    if (!unlockResult.success) {
      logger.error("MDM camera unlock failed", {
        requestId,
        deviceId,
        platform: device.deviceInfo.platform,
        error: unlockResult.error,
        facilityId: qrCode.facilityId._id,
        enrollmentId: enrollment._id,
      });

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

    logger.logEnrollment(
      "completed",
      {
        enrollmentId: enrollment._id,
        deviceId: device.deviceId,
        facilityId: qrCode.facilityId._id,
        status: enrollment.status,
        unenrolledAt: enrollment.unenrolledAt,
      },
      { requestId }
    );

    // Update device status
    device.status = "inactive";
    device.currentFacility = null;
    device.lastEnrollment = enrollment._id;
    await device.save();

    logger.info("Device status updated to inactive", {
      requestId,
      deviceId,
      status: device.status,
      previousFacility: device.currentFacility,
      lastEnrollment: device.lastEnrollment,
    });

    // Record scan
    await qrCode.recordScan();

    // Return response in requested format
    logger.info("Exit scan completed successfully", {
      requestId,
      deviceId,
      id: enrollment._id,
      facilityName: qrCode.facilityId.name,
    });

    res.status(200).json({
      status: "success",
      message: "Exit allowed",
      data: {
        action: "UNLOCK_CAMERA",
      },
    });
  } catch (error) {
    logger.logQRError("exit", error, {
      requestId,
      deviceId,
      token,
      stack: error.stack,
    });

    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
