const mongoose = require("mongoose");
const ForceExitRequest = require("../models/ForceExitRequest.model");
const Device = require("../models/Device.model");
const Enrollment = require("../models/Enrollment.model");
const Facility = require("../models/Facility.model");
const { generateRestoreToken } = require("../utils/jwt");
const firebaseService = require("../utils/firebaseService");
const mdmService = require("../utils/mdmService");
const logger = require("../utils/logger");

// @desc    Create a new force exit request for user
// @route   POST /api/force-exit/request
exports.createForceExitRequest = async (req, res) => {
  const requestId = req.requestId || new mongoose.Types.ObjectId();
  const { deviceId, reason } = req.body;

  logger.info("Force exit request received", {
    requestId,
    deviceId,
    hasReason: !!reason,
    userAgent: req.get("User-Agent"),
    ip: req.ip,
  });

  try {
    if (!deviceId) {
      const error = "deviceId is required";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Find device and active enrollment
    const device = await Device.findOne({ deviceId }).populate(
      "lastEnrollment"
    );

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

    // Check if device has an active enrollment
    if (
      !device.currentFacility ||
      device.status !== "active" ||
      !device.lastEnrollment
    ) {
      const error = "Device is not currently enrolled in any facility";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Check if device already has a pending request
    const hasPending = await ForceExitRequest.findOne({
      deviceId: device._id,
      status: "pending",
    });

    logger.debug("Pending request check", {
      requestId,
      deviceId,
      hasPendingRequest: !!hasPending,
    });

    if (hasPending) {
      const error = "A force exit request is already pending for this device";
      logger.warn(error, {
        requestId,
        deviceId,
      });

      return res.status(409).json({
        status: "error",
        message: error,
      });
    }

    // Create force exit request
    const forceExitRequest = await ForceExitRequest.create({
      deviceId: device._id,
      visitorId: device.lastEnrollment.visitorId,
      facilityId: device.currentFacility,
      reason,
    });

    logger.info("Force exit request created", {
      requestId,
      forceExitRequestId: forceExitRequest._id,
      deviceId,
      facilityId: device.currentFacility,
      visitorId: forceExitRequest.visitorId,
    });

    res.status(201).json({
      status: "success",
      message: "Force exit request submitted successfully",
      data: {
        requestId: forceExitRequest._id,
        status: forceExitRequest.status,
        requestedAt: forceExitRequest.requestedAt,
      },
    });
  } catch (error) {
    logger.error("Create force exit request failed", {
      requestId,
      deviceId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Get force exit request status for device
// @route   GET /api/force-exit/status/:deviceId
exports.getRequestStatus = async (req, res) => {
  const requestId = req.requestId || new mongoose.Types.ObjectId();
  const { deviceId } = req.params;

  logger.info("Get force exit request status", {
    requestId,
    deviceId,
  });

  try {
    if (!deviceId) {
      const error = "deviceId is required";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    const device = await Device.findOne({ deviceId });

    if (!device) {
      const error = "Device not found";

      return res.status(404).json({
        status: "error",
        message: error,
      });
    }

    const latestRequest = await ForceExitRequest.findOne({
      deviceId: device._id,
    })
      .populate("facilityId", "name location")
      .sort({ requestedAt: -1 });

    logger.debug("Latest request lookup", {
      requestId,
      deviceId,
      hasRequest: !!latestRequest,
      requestStatus: latestRequest?.status,
    });

    if (!latestRequest) {
      return res.status(200).json({
        status: "success",
        message: "No force exit requests found for this device",
        data: {
          hasRequest: false,
        },
      });
    }

    res.status(200).json({
      status: "success",
      message: "Request status retrieved successfully",
      data: {
        hasRequest: true,
        requestId: latestRequest.requestId,
        status: latestRequest.status,
        requestedAt: latestRequest.requestedAt,
        approvedAt: latestRequest.approvedAt,
        deniedAt: latestRequest.deniedAt,
        completedAt: latestRequest.completedAt,
        reason: latestRequest.reason,
        adminNotes: latestRequest.adminNotes,
        facility: latestRequest.facilityId,
      },
    });
  } catch (error) {
    logger.error("Get request status failed", {
      requestId,
      deviceId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Handle force exit completion (when user taps notification)
// @route   POST /api/force-exit/complete
exports.completeForceExit = async (req, res) => {
  const requestId = req.requestId || new mongoose.Types.ObjectId();
  const { token, deviceId } = req.body;

  logger.info("Complete force exit request", {
    requestId,
    deviceId,
    hasToken: !!token,
  });

  try {
    if (!token || !deviceId) {
      const error = "token and deviceId are required";
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

    // This will reuse the existing restoreFromPush logic
    // but we'll also update the force exit request status
    const device = await Device.findOne({ deviceId });

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

    // Find the approved force exit request
    const forceExitRequest = await ForceExitRequest.findOne({
      deviceId: device._id,
      status: "approved",
    }).sort({ approvedAt: -1 });

    if (!forceExitRequest) {
      const error = "No approved force exit request found";

      return res.status(404).json({
        status: "error",
        message: error,
      });
    }

    // Attempt to unlock camera
    logger.info("Attempting camera unlock for force exit", {
      requestId,
      deviceId,
      platform: device.deviceInfo.platform,
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
        reason: "force_exit_completion",
      }
    );

    // Close active enrollment
    const enrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: "active",
    });

    if (enrollment) {
      enrollment.status = "forced_exit";
      enrollment.unenrolledAt = new Date();
      await enrollment.save();

      logger.info("Enrollment marked as forced exit", {
        requestId,
        enrollmentId: enrollment._id,
        deviceId,
      });
    }

    // Update device status
    device.status = "inactive";
    device.currentFacility = null;
    await device.save();

    // Mark force exit request as completed
    await forceExitRequest.complete();

    logger.info("Force exit completed successfully", {
      requestId,
      deviceId,
      forceExitRequestId: forceExitRequest.requestId,
      unlockSuccess: unlockResult.success,
    });

    res.status(200).json({
      status: "success",
      message: "Force exit completed successfully",
      data: {
        action: "UNLOCK_CAMERA",
        unlockSuccess: unlockResult.success,
      },
    });
  } catch (error) {
    logger.error("Complete force exit failed", {
      requestId,
      deviceId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Get pending force exit requests for admin
// @route   GET /api/force-exit/pendingList
exports.getPendingRequestsList = async (req, res) => {
  const requestId = req.requestId || new mongoose.Types.ObjectId();
  const { facilityId } = req.query;

  try {
    // Find facilities created by this admin
    const adminFacilities = await Facility.find({
      createdBy: req.admin?._id,
    }).select("_id");
    const facilityIds = adminFacilities.map((f) => f._id);

    let queryFacilityId = facilityId;

    // If facilityId is provided in query, verify it belongs to the admin
    if (facilityId) {
      const facility = await Facility.findOne({
        _id: facilityId,
        createdBy: req.admin?._id,
      });
      if (!facility) {
        return res.status(403).json({
          status: "error",
          message:
            "You do not have permission to access requests for this facility",
        });
      }
      queryFacilityId = facility._id;
    } else {
      // If no facilityId provided, default to all facilities owned by admin
      queryFacilityId = { $in: facilityIds };
    }

    const pendingRequests = await ForceExitRequest.find({
      status: "pending",
      facilityId: queryFacilityId,
    })
      .populate("deviceId", "deviceId deviceInfo visitorId pushToken")
      .populate("facilityId", "name location")
      .sort({ requestedAt: -1 });

    logger.info("Pending requests retrieved", {
      requestId,
      count: pendingRequests.length,
      facilityId,
    });

    res.status(200).json({
      status: "success",
      message: "Pending requests retrieved successfully",
      data: {
        requests: pendingRequests,
        count: pendingRequests.length,
      },
    });
  } catch (error) {
    logger.error("Get pending requests failed", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Approve a force exit request
// @route   POST /api/force-exit/approve/:requestId
exports.approveRequest = async (req, res) => {
  const requestId = req.requestId || new mongoose.Types.ObjectId();
  const { id } = req.params;
  const { adminNotes } = req.body;
  const adminId = req.admin?._id;

  try {
    if (!id) {
      const error = "Request ID is required";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    const forceExitRequest = await ForceExitRequest.findById(id).populate(
      "deviceId"
    );

    logger.debug("Force exit request lookup", {
      requestId,
      forceExitRequestId: id,
      requestFound: !!forceExitRequest,
      currentStatus: forceExitRequest?.status,
    });

    if (!forceExitRequest) {
      const error = "Force exit request not found";

      return res.status(404).json({
        status: "error",
        message: error,
      });
    }

    // Check if the facility belongs to the admin
    const facility = await Facility.findOne({
      _id: forceExitRequest.facilityId,
      createdBy: req.admin?._id,
    });
    if (!facility) {
      const error =
        "You do not have permission to approve requests for this facility";

      return res.status(403).json({
        status: "error",
        message: error,
      });
    }

    if (forceExitRequest.status !== "pending") {
      const error = `Request cannot be approved. Current status: ${forceExitRequest.status}`;

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Approve the request
    await forceExitRequest.approve(adminId, adminNotes);

    logger.info("Force exit request approved", {
      requestId,
      forceExitRequestId,
      approvedAt: forceExitRequest.approvedAt,
      deviceId: forceExitRequest.deviceId.deviceId,
    });

    // Send push notification to device
    const device = forceExitRequest.deviceId;
    if (device.pushToken) {
      const restoreToken = generateRestoreToken(device.deviceId);

      logger.info("Sending push notification for approved request", {
        requestId,
        forceExitRequestId,
        deviceId: device.deviceId,
        hasPushToken: !!device.pushToken,
      });

      const pushPayload = {
        type: "FORCE_EXIT_APPROVED",
        deviceId: device.deviceId,
        token: restoreToken,
        facilityId: forceExitRequest.facilityId,
        title: "CamBlock - Exit Approved",
        message:
          "Your force exit request has been approved. Tap to restore permissions.",
      };

      const pushResult = await firebaseService.sendEnhancedPush(
        device.pushToken,
        pushPayload
      );

      // Update request with push notification status
      forceExitRequest.pushNotificationSent = pushResult.success;
      forceExitRequest.pushNotificationSentAt = new Date();
      await forceExitRequest.save();

      logger.info("Push notification result", {
        requestId,
        forceExitRequestId,
        pushSuccess: pushResult.success,
        pushError: pushResult.error,
      });
    } else {
      logger.warn("No push token available for device", {
        requestId,
        forceExitRequestId,
        deviceId: device.deviceId,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Force exit request approved successfully",
      data: {
        requestId: forceExitRequest.requestId,
        status: forceExitRequest.status,
        approvedAt: forceExitRequest.approvedAt,
        pushNotificationSent: forceExitRequest.pushNotificationSent,
      },
    });
  } catch (error) {
    logger.error("Approve force exit request failed", {
      requestId,
      forceExitRequestId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Deny a force exit request
// @route   POST /api/force-exit/deny/:requestId
exports.denyRequest = async (req, res) => {
  const requestId = req.requestId || new mongoose.Types.ObjectId();
  const { id } = req.params;
  const { adminNotes } = req.body;
  const adminId = req.admin?._id;

  try {
    if (!id) {
      const error = "Request ID is required";

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    const forceExitRequest = await ForceExitRequest.findById(id).populate(
      "deviceId"
    );

    if (!forceExitRequest) {
      const error = "Force exit request not found";

      return res.status(404).json({
        status: "error",
        message: error,
      });
    }

    // Check if the facility belongs to the admin
    const facility = await Facility.findOne({
      _id: forceExitRequest.facilityId,
      createdBy: req.admin?._id,
    });
    if (!facility) {
      const error =
        "You do not have permission to deny requests for this facility";

      return res.status(403).json({
        status: "error",
        message: error,
      });
    }

    if (forceExitRequest.status !== "pending") {
      const error = `Request cannot be denied. Current status: ${forceExitRequest.status}`;

      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    // Deny the request
    await forceExitRequest.deny(adminId, adminNotes);

    logger.info("Force exit request denied", {
      requestId,
      forceExitRequestId,
      deniedAt: forceExitRequest.deniedAt,
      deviceId: forceExitRequest.deviceId.deviceId,
    });

    // Optional: Send push notification about denial
    const device = forceExitRequest.deviceId;
    if (device.pushToken) {
      logger.info("Sending denial push notification", {
        requestId,
        forceExitRequestId,
        deviceId: device.deviceId,
      });

      const pushPayload = {
        type: "FORCE_EXIT_DENIED",
        deviceId: device.deviceId,
        facilityId: forceExitRequest.facilityId,
        title: "CamBlock - Exit Request Denied",
        message:
          "Your force exit request has been denied. Please contact facility staff.",
      };

      await firebaseService.sendEnhancedPush(device.pushToken, pushPayload);
    }

    res.status(200).json({
      status: "success",
      message: "Force exit request denied successfully",
      data: {
        requestId: forceExitRequest.requestId,
        status: forceExitRequest.status,
        deniedAt: forceExitRequest.deniedAt,
      },
    });
  } catch (error) {
    logger.error("Deny force exit request failed", {
      requestId,
      forceExitRequestId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
