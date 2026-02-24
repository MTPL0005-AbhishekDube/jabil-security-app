const Enrollment = require('../models/Enrollment.model');
const Device = require('../models/Device.model');
const QRCode = require('../models/QRCode.model');
const Facility = require('../models/Facility.model');
const mdmService = require('../utils/mdmService');
const { verifyToken } = require('../utils/jwt');
const { v4: uuidv4 } = require('uuid');

// @desc    Scan entry QR and enroll device (lock camera)
// @route   POST /api/enrollments/scan-entry
exports.scanEntry = async (req, res) => {
  try {
    const { 
      token, 
      deviceId, 
      deviceInfo 
    } = req.body;

    // Validate required fields
    if (!token || !deviceId || !deviceInfo) {
      return res.status(400).json({
        status: 'error',
        message: 'Token, deviceId, and deviceInfo are required'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (error) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired token'
      });
    }

    // Find QR code in database
    const qrCode = await QRCode.findOne({ 
      qrCodeId: decoded.qrCodeId 
    }).populate('facilityId');

    if (!qrCode || !qrCode.isValid()) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired QR code'
      });
    }

    // Check if it's an entry QR
    if (qrCode.type !== 'entry') {
      return res.status(400).json({
        status: 'error',
        message: 'This QR code is not for entry'
      });
    }

    // Find or create device
    let device = await Device.findOne({ deviceId });
    
    if (!device) {
      device = await Device.create({
        deviceId,
        deviceInfo,
        status: 'inactive'
      });
    } else {
      // Update device info
      device.deviceInfo = deviceInfo;
      await device.save();
    }

    // Check if device is already enrolled (double entry)
    const existingEnrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: 'active'
    });

    if (existingEnrollment) {
      // EDGE CASE 1: Device is already enrolled in the SAME facility
      // Action: Return 200 OK (Idempotent success) but do not create new enrollment
      if (existingEnrollment.facilityId.toString() === qrCode.facilityId._id.toString()) {
          
          // Re-send lock command just in case
          await mdmService.lockCamera(deviceId, deviceInfo.platform);

          return res.status(200).json({
              status: 'success',
              message: 'Device is already enrolled. Camera locked.',
              data: {
                  enrollmentId: existingEnrollment.enrollmentId,
                  facilityName: qrCode.facilityId.name,
                  action: 'LOCK_CAMERA'
              }
          });
      }

      // EDGE CASE 2: Device is enrolled in a DIFFERENT facility
      // Action: Return 409 Conflict
      return res.status(409).json({
        status: 'error',
        message: 'Device is already enrolled in another facility. Please scan exit there first.'
      });
    }

    // Enroll device with MDM (Lock Camera)
    const lockResult = await mdmService.lockCamera(deviceId, deviceInfo.platform);

    if (!lockResult.success) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to lock camera',
        error: lockResult.error
      });
    }

    // Create enrollment record
    const enrollmentId = uuidv4();
    
    const enrollment = await Enrollment.create({
      enrollmentId,
      deviceId: device._id,
      facilityId: qrCode.facilityId._id,
      entryQRCode: qrCode._id,
      status: 'active',
      enrolledAt: new Date()
    });

    // Update device status
    device.status = 'active';
    device.currentFacility = qrCode.facilityId._id;
    device.lastEnrollment = enrollment._id;
    await device.save();

    // Record scan on QR code
    await qrCode.recordScan();

    // Return response in requested format
    res.status(200).json({
      status: 'success',
      message: 'Entry allowed',
      data: {
        enrollmentId: enrollment.enrollmentId,
        facilityName: qrCode.facilityId.name,
        action: 'LOCK_CAMERA'
      }
    });

  } catch (error) {
    console.error('Scan entry error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
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
        status: 'error',
        message: 'Token and deviceId are required'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (error) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired token'
      });
    }

    // Find QR code
    const qrCode = await QRCode.findOne({ qrCodeId: decoded.qrCodeId });

    if (!qrCode || !qrCode.isValid()) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired QR code'
      });
    }

    // Check if it's an exit QR
    if (qrCode.type !== 'exit') {
      return res.status(400).json({
        status: 'error',
        message: 'This QR code is not for exit'
      });
    }

    // Find device
    const device = await Device.findOne({ deviceId });

    if (!device) {
      // EDGE CASE 3: Device not found (never enrolled)
      // Action: Return 200 OK with UNLOCK command (Safety net)
      // Even if we don't know them, if they scan exit, we should ensure their camera is unlocked.
      return res.status(200).json({
        status: 'success',
        message: 'Exit allowed (Device not registered)',
        data: {
          action: 'UNLOCK_CAMERA'
        }
      });
    }

    // Find active enrollment
    const enrollment = await Enrollment.findOne({
      deviceId: device._id,
      status: 'active'
    });

    if (!enrollment) {
      // EDGE CASE 4: Device exists but no active enrollment (Already exited or never entered)
      // Action: Return 200 OK with UNLOCK command (Idempotent success)
      
      // Force unlock just in case
      await mdmService.unlockCamera(
        deviceId, 
        device.deviceInfo.platform
      );

      return res.status(200).json({
        status: 'success',
        message: 'Exit allowed (Already checked out)',
        data: {
          action: 'UNLOCK_CAMERA'
        }
      });
    }

    // Unlock camera (skip if already forced exit in past)
    const unlockResult = await mdmService.unlockCamera(
      deviceId, 
      device.deviceInfo.platform
    );

    if (!unlockResult.success) {
      return res.status(500).json({
        status: 'error',
        message: 'Failed to unlock camera',
        error: unlockResult.error
      });
    }

    // Update enrollment
    enrollment.status = 'completed';
    enrollment.unenrolledAt = new Date();
    enrollment.exitQRCode = qrCode._id;
    await enrollment.save();

    // Update device status
    device.status = 'inactive';
    device.currentFacility = null;
    device.lastEnrollment = enrollment._id;
    await device.save();

    // Record scan
    await qrCode.recordScan();

    // Return response in requested format
    res.status(200).json({
      status: 'success',
      message: 'Exit allowed',
      data: {
        action: 'UNLOCK_CAMERA'
      }
    });

  } catch (error) {
    console.error('Scan exit error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
};

// @desc    Admin: force exit (unlock) when user forgot to scan exit
// @route   POST /api/enrollments/admin/force-exit
// @note    Protect this route with auth middleware when available.
exports.forceExitAdmin = async (req, res) => {
  try {
    const { enrollmentId, reason, initiatedBy, deviceId } = req.body;

    if (!enrollmentId && !deviceId) {
      return res.status(400).json({
        status: 'error',
        message: 'enrollmentId or deviceId is required'
      }); 
    }

    // Find enrollment by id or by active device
    let enrollment = null;
    if (enrollmentId) {
      enrollment = await Enrollment.findOne({ enrollmentId, status: 'active' }).populate('deviceId');
    }
    if (!enrollment && deviceId) {
      const device = await Device.findOne({ deviceId });
      if (device) {
        enrollment = await Enrollment.findOne({ deviceId: device._id, status: 'active' }).populate('deviceId');
      }
    }

    if (!enrollment || !enrollment.deviceId) {
      return res.status(404).json({
        status: 'error',
        message: 'Active enrollment not found'
      });
    }

    const device = enrollment.deviceId;

    // Unlock camera
    await mdmService.unlockCamera(device.deviceId, device.deviceInfo.platform);

    // Update enrollment & device
    enrollment.status = 'forced_exit';
    enrollment.unenrolledAt = new Date();
    if (initiatedBy) enrollment.initiatedBy = initiatedBy;
    if (reason) enrollment.reason = reason;
    await enrollment.save();

    device.status = 'inactive';
    device.currentFacility = null;
    device.lastEnrollment = enrollment._id;
    await device.save();

    return res.status(200).json({
      status: 'success',
      message: 'Device exited and camera unlocked by admin',
      data: {
        action: 'UNLOCK_CAMERA',
        enrollmentId: enrollment.enrollmentId
      }
    });
  } catch (error) {
    console.error('Admin force-exit error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
};