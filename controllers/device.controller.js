const Device = require("../models/Device.model");
const Enrollment = require("../models/Enrollment.model");
const mdmService = require("../utils/mdmService");
const { generateRestoreToken } = require("../utils/jwt");

// @desc    Admin: list active devices (search by deviceId/visitorId/model)
// @route   GET /api/admin/devices/active
exports.listActiveDevices = async (req, res) => {
  try {
    const { page = 1, limit = 10, q } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const skip = (pageNum - 1) * limitNum;

  const filter = { status: "active" };
  if (q) {
    const regex = new RegExp(q, "i");
    filter.$or = [
      { deviceId: regex },
      { visitorId: regex },
      { "deviceInfo.deviceName": regex },
      { "deviceInfo.model": regex },
    ];
  }

    const [items, total] = await Promise.all([
      Device.find(filter)
        .populate("currentFacility", "name facilityId")
        .skip(skip)
        .limit(limitNum)
        .sort({ updatedAt: -1 }),
      Device.countDocuments(filter),
    ]);

    return res.status(200).json({
      status: "success",
      data: {
        items,
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Admin: get active enrollment details by deviceId (for forgotten exit)
// @route   GET /api/enrollments/admin/active-device/:deviceId
exports.getActiveDeviceById = async (req, res) => {
  try {
    const { deviceId } = req.params;

    if (!deviceId) {
      return res.status(400).json({
        status: "error",
        message: "deviceId is required",
      });
    }

    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({
        status: "error",
        message: "Device not found",
      });
    }

    const enrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: "active",
    })
      .populate("facilityId")
      .populate("entryQRCode")
      .populate("exitQRCode");

    if (!enrollment) {
      return res.status(404).json({
        status: "error",
        message: "No active enrollment for this device",
      });
    }

    return res.status(200).json({
      status: "success",
      data: {
        enrollmentId: enrollment.enrollmentId,
        device: {
          deviceId: device.deviceId,
          deviceName: device.deviceInfo?.deviceName,
          platform: device.deviceInfo?.platform,
          model: device.deviceInfo?.model,
          status: device.status,
        },
        facility: enrollment.facilityId
          ? {
              id: enrollment.facilityId._id,
              name: enrollment.facilityId.name,
            }
          : null,
        entryQRCode: enrollment.entryQRCode
          ? {
              id: enrollment.entryQRCode._id,
              name: enrollment.entryQRCode.qrCodeId,
            }
          : null,
        enrolledAt: enrollment.enrolledAt,
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

// @desc    Admin: force exit (unlock) when user forgot to scan exit
// @route   POST /api/enrollments/admin/force-exit
// @note    Protect this route with auth middleware when available.
exports.forceExit = async (req, res) => {
  try {
    const { enrollmentId, reason, initiatedBy } = req.body;
    const deviceId = req.body.deviceId || req.params?.deviceId;

    if (!enrollmentId && !deviceId) {
      return res.status(400).json({
        status: "error",
        message: "enrollmentId or deviceId is required",
      });
    }

    // Find enrollment by id or by active device
    let enrollment = null;
    if (enrollmentId) {
      enrollment = await Enrollment.findOne({
        enrollmentId,
        status: "active",
      }).populate("deviceId");
    }
    if (!enrollment && deviceId) {
      const device = await Device.findOne({ deviceId });
      if (device) {
        enrollment = await Enrollment.findOne({
          deviceId: device._id,
          status: "active",
        }).populate("deviceId");
      }
    }

    if (!enrollment || !enrollment.deviceId) {
      return res.status(404).json({
        status: "error",
        message: "Active enrollment not found",
      });
    }

    const device = enrollment.deviceId;

    // Unlock camera
    await mdmService.unlockCamera(device.deviceId, device.deviceInfo.platform);

    // Send restore push notification (best-effort)
    let pushResult = { success: false, reason: "missing_push_token" };
    let restoreToken = null;
    if (device.pushToken) {
      restoreToken = generateRestoreToken({
        enrollmentId: enrollment.enrollmentId,
        deviceId: device.deviceId,
      });
      pushResult = await mdmService.sendPushNotification(device.pushToken, {
        type: "RESTORE",
        token: restoreToken,
        deviceId: device.deviceId,
        facilityId: enrollment.facilityId,
        message: "Tap to restore your device permissions",
      });
    }

    // Update enrollment & device
    enrollment.status = "forced_exit";
    enrollment.unenrolledAt = new Date();
    if (initiatedBy) enrollment.initiatedBy = initiatedBy;
    if (reason) enrollment.reason = reason;
    await enrollment.save();

    device.status = "inactive";
    device.currentFacility = null;
    device.lastEnrollment = enrollment._id;
    await device.save();

    return res.status(200).json({
      status: "success",
      message: "Device exited and camera unlocked by admin",
      data: {
        action: "UNLOCK_CAMERA",
        enrollmentId: enrollment.enrollmentId,
        pushSent: pushResult.success,
        restoreToken,
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
