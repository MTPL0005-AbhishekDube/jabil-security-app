const Enrollment = require("../models/Enrollment.model");
const Device = require("../models/Device.model");
const QRCode = require("../models/QRCode.model");
const mdmService = require("../utils/mdmService");
const { verifyToken } = require("../utils/jwt");
const { v4: uuidv4 } = require("uuid");
const { generateNextVisitorId } = require("../utils/visitorId");
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

// @desc    Scan entry QR and enroll device (lock camera)
// @route   POST /api/enrollments/scan-entry
exports.scanEntry = async (req, res) => {
  const requestId = req.requestId || uuidv4();
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

    logger.debug("Token normalized", {
      requestId,
      originalTokenLength: token?.length,
      normalizedTokenLength: normalizedToken?.length,
    });

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
        qrCodeId: decoded.qrCodeId,
      });

      qrCode = await QRCode.findOne({ qrCodeId: decoded.qrCodeId }).populate(
        "facilityId"
      );

      if (!qrCode) {
        logger.warn("QR Code not found after JWT verification", {
          requestId,
          qrCodeId: decoded.qrCodeId,
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
        decoded = { qrCodeId: qrCode.qrCodeId };
        logger.info("Fallback lookup successful", {
          requestId,
          qrCodeId: qrCode.qrCodeId,
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
        qrCodeId: qrCode?.qrCodeId,
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
        qrCodeId: qrCode.qrCodeId,
        facilityId: qrCode.facilityId?._id,
        facilityStatus: qrCode.facilityId?.status,
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
        qrCodeId: qrCode.qrCodeId,
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
      logger.warn(error, {
        requestId,
        qrCodeId: qrCode.qrCodeId,
        actualType: qrCode.type,
        expectedType: "entry",
      });

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
        visitorId: await generateNextVisitorId(),
      });

      logger.info("New device created successfully", {
        requestId,
        deviceId,
        visitorId: device.visitorId,
        deviceId_db: device._id,
      });
    } else {
      // Update device info
      const oldDeviceInfo = device.deviceInfo;
      const oldPushToken = device.pushToken;

      device.deviceInfo = deviceInfo;
      if (pushToken) device.pushToken = pushToken;
      if (!device.visitorId) {
        device.visitorId = await generateNextVisitorId();
      }
      await device.save();

      logger.info("Device updated", {
        requestId,
        deviceId,
        deviceInfoChanged:
          JSON.stringify(oldDeviceInfo) !== JSON.stringify(deviceInfo),
        pushTokenChanged: oldPushToken !== pushToken,
        visitorId: device.visitorId,
      });
    }

    // Check if device is already enrolled (double entry)
    const existingEnrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: "active",
    });

    logger.debug("Checking existing enrollment", {
      requestId,
      deviceId,
      hasExistingEnrollment: !!existingEnrollment,
      existingFacility: existingEnrollment?.facilityId,
    });

    if (existingEnrollment) {
      // EDGE CASE 1: Device is already enrolled in the SAME facility
      // Action: Return 200 OK (Idempotent success) but do not create new enrollment
      if (
        existingEnrollment.facilityId.toString() ===
        qrCode.facilityId._id.toString()
      ) {
        logger.info(
          "Device already enrolled in same facility - idempotent success",
          {
            requestId,
            deviceId,
            enrollmentId: existingEnrollment.enrollmentId,
            facilityId: qrCode.facilityId._id,
            facilityName: qrCode.facilityId.name,
          }
        );

        // Re-send lock command just in case
        const lockResult = await mdmService.lockCamera(
          deviceId,
          deviceInfo.platform
        );
        logger.logMDMOperation(
          "lockCamera",
          deviceId,
          deviceInfo.platform,
          lockResult,
          {
            requestId,
            reason: "idempotent_retry",
          }
        );

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
      const error =
        "Device is already enrolled in another facility. Please scan exit there first.";
      logger.warn(error, {
        requestId,
        deviceId,
        currentFacility: existingEnrollment.facilityId,
        attemptedFacility: qrCode.facilityId._id,
        currentEnrollmentId: existingEnrollment.enrollmentId,
      });

      return res.status(409).json({
        status: "error",
        message: error,
      });
    }

    // Enroll device with MDM (Lock Camera)
    logger.info("Attempting to lock camera via MDM", {
      requestId,
      deviceId,
      platform: deviceInfo.platform,
      facilityId: qrCode.facilityId._id,
    });

    const lockResult = await mdmService.lockCamera(
      deviceId,
      deviceInfo.platform
    );

    logger.logMDMOperation(
      "lockCamera",
      deviceId,
      deviceInfo.platform,
      lockResult,
      {
        requestId,
        facilityId: qrCode.facilityId._id,
        facilityName: qrCode.facilityId.name,
      }
    );

    if (!lockResult.success) {
      logger.error("MDM camera lock failed", {
        requestId,
        deviceId,
        platform: deviceInfo.platform,
        error: lockResult.error,
        facilityId: qrCode.facilityId._id,
      });

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

    logger.debug("Looking for existing enrollment record", {
      requestId,
      deviceId,
      existingRecordFound: !!enrollment,
      previousStatus: enrollment?.status,
    });

    if (!enrollment) {
      enrollment = new Enrollment({
        enrollmentId: uuidv4(),
        deviceId: device._id,
      });

      logger.info("Created new enrollment record", {
        requestId,
        deviceId,
        enrollmentId: enrollment.enrollmentId,
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

    logger.logEnrollment(
      "created/updated",
      {
        enrollmentId: enrollment.enrollmentId,
        deviceId: device.deviceId,
        facilityId: qrCode.facilityId._id,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt,
      },
      { requestId }
    );

    // Update device status
    device.status = "active";
    device.currentFacility = qrCode.facilityId._id;
    device.lastEnrollment = enrollment._id;
    await device.save();

    logger.info("Device status updated to active", {
      requestId,
      deviceId,
      status: device.status,
      currentFacility: device.currentFacility,
      lastEnrollment: device.lastEnrollment,
    });

    // Record scan on QR code
    await qrCode.recordScan();

    logger.info("QR scan recorded", {
      requestId,
      qrCodeId: qrCode.qrCodeId,
      scanCount: qrCode.scanCount,
    });

    // Return response in requested format
    logger.info("Entry scan completed successfully", {
      requestId,
      deviceId,
      enrollmentId: enrollment.enrollmentId,
      facilityName: qrCode.facilityId.name,
      visitorId: device.visitorId,
    });

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
    logger.logQRError("entry", error, {
      requestId,
      deviceId,
      token,
      deviceInfo,
      stack: error.stack,
    });

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
  const requestId = req.requestId || uuidv4();
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
      logger.warn("Token normalization failed", {
        requestId,
        error,
        originalTokenLength: token?.length,
      });

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    try {
      decoded = verifyToken(normalizedToken);
      logger.debug("JWT token verified successfully", {
        requestId,
        qrCodeId: decoded.qrCodeId,
      });

      qrCode = await QRCode.findOne({ qrCodeId: decoded.qrCodeId }).populate(
        "facilityId"
      );

      if (!qrCode) {
        logger.warn("QR Code not found after JWT verification", {
          requestId,
          qrCodeId: decoded.qrCodeId,
        });
      }
    } catch (error) {
      logger.warn("JWT verification failed, trying fallback lookup", {
        requestId,
        error: error.message,
        tokenLength: normalizedToken?.length,
      });

      qrCode = await QRCode.findOne({ token: normalizedToken }).populate(
        "facilityId"
      );

      if (qrCode) {
        decoded = { qrCodeId: qrCode.qrCodeId };
        logger.info("Fallback lookup successful", {
          requestId,
          qrCodeId: qrCode.qrCodeId,
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
        qrCodeId: qrCode?.qrCodeId,
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
        qrCodeId: qrCode.qrCodeId,
        facilityId: qrCode.facilityId?._id,
        facilityStatus: qrCode.facilityId?.status,
      });

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Check if it's an exit QR
    if (qrCode.type !== "exit") {
      const error = "This QR code is not for exit";
      logger.warn(error, {
        requestId,
        qrCodeId: qrCode.qrCodeId,
        actualType: qrCode.type,
        expectedType: "exit",
      });

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
      enrollmentId: enrollment?.enrollmentId,
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
      logger.warn(error, {
        requestId,
        deviceId,
        enrollmentFacility: enrollment.facilityId,
        qrFacility: qrCode.facilityId?._id,
        enrollmentId: enrollment.enrollmentId,
        qrCodeId: qrCode.qrCodeId,
      });

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
      enrollmentId: enrollment.enrollmentId,
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
        enrollmentId: enrollment.enrollmentId,
      }
    );

    if (!unlockResult.success) {
      logger.error("MDM camera unlock failed", {
        requestId,
        deviceId,
        platform: device.deviceInfo.platform,
        error: unlockResult.error,
        facilityId: qrCode.facilityId._id,
        enrollmentId: enrollment.enrollmentId,
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
        enrollmentId: enrollment.enrollmentId,
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

    logger.info("QR scan recorded", {
      requestId,
      qrCodeId: qrCode.qrCodeId,
      scanCount: qrCode.scanCount,
    });

    // Return response in requested format
    logger.info("Exit scan completed successfully", {
      requestId,
      deviceId,
      enrollmentId: enrollment.enrollmentId,
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
