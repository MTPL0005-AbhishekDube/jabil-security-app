const Facility = require("../models/Facility.model");
const QRCode = require("../models/QRCode.model");
const qrGenerator = require("../utils/qrGenerator");
const logger = require("../utils/logger");
const cron = require("node-cron");
const fs = require("fs").promises;

/**
 * Calculates the next rotation timestamp based on facility settings
 * @param {Date} referenceDate 
 * @param {Number} value 
 * @param {String} unit 
 * @returns {Date}
 */
const calculateNextRotation = (referenceDate, value, unit) => {
  const date = new Date(referenceDate);
  switch (unit) {
    case "seconds":
      date.setSeconds(date.getSeconds() + value);
      break;
    case "minutes":
      date.setMinutes(date.getMinutes() + value);
      break;
    case "hours":
      date.setHours(date.getHours() + value);
      break;
    case "days":
      date.setDate(date.getDate() + value);
      break;
    default:
      date.setHours(date.getHours() + 24); // Default 24h
  }
  return date;
};

/**
 * Rotates QR codes for a specific facility
 * @param {Object} facility 
 * @returns {Promise<Object>} The fresh QR codes
 */
const rotateFacilityQRs = async (facility) => {
  try {
    const now = new Date();
    
    // Step 1: Get existing QR codes for this facility to delete their images
    const existingQRCodes = await QRCode.find({ facilityId: facility._id });
    
    // Step 2: Delete old QR code image files
    for (const qr of existingQRCodes) {
      if (qr.imagePath) {
        try {
          await fs.unlink(qr.imagePath);
          logger.info(`Deleted old QR image: ${qr.imagePath}`, { facilityId: facility._id });
        } catch (err) {
          // File might not exist, log but continue
          logger.warn(`Failed to delete QR image ${qr.imagePath}: ${err.message}`);
        }
      }
    }
    
    // Step 3: Delete existing QR codes from database
    await QRCode.deleteMany({ facilityId: facility._id });

    // Step 4: Generate new QR codes
    // We use a fixed ID pattern or just fresh IDs. 
    // Since we decoupled, we just need a valid Entry and Exit for this facility.
    
    // Entry QR
    const entry = await qrGenerator.generateCompleteQRCode(
      "lock",
      facility._id,
      { location: facility.name, type: "entry" }
    );

    const entryDoc = await QRCode.create([{
      _id: entry.id,
      facilityId: facility._id,
      facilityName: facility.name,
      type: "entry",
      action: "lock",
      token: entry.token,
      url: entry.url,
      imagePath: entry.imagePath,
      metadata: { location: facility.name, type: "entry" },
      status: "active",
      validFrom: now,
      validUntil: calculateNextRotation(now, facility.qrDurationValue, facility.qrDurationUnit),
    }]);

    // Exit QR
    const exit = await qrGenerator.generateCompleteQRCode(
      "unlock",
      facility._id,
      { location: facility.name, type: "exit" }
    );

    const exitDoc = await QRCode.create([{
      _id: exit.id,
      facilityId: facility._id,
      facilityName: facility.name,
      type: "exit",
      action: "unlock",
      token: exit.token,
      url: exit.url,
      imagePath: exit.imagePath,
      metadata: { location: facility.name, type: "exit" },
      status: "active",
      validFrom: now,
      validUntil: calculateNextRotation(now, facility.qrDurationValue, facility.qrDurationUnit),
    }]);

    // Step 5: Update facility's qrNextRotationAt
    const qrNextRotationAt = calculateNextRotation(now, facility.qrDurationValue, facility.qrDurationUnit);
    await Facility.updateOne(
      { _id: facility._id },
      { $set: { qrNextRotationAt } }
    );

    logger.info(`QR codes rotated for facility: ${facility.name}`, { facilityId: facility._id, qrNextRotationAt });

    return { entry: entryDoc[0], exit: exitDoc[0] };
  } catch (error) {
    logger.error(`Failed to rotate QR codes for facility ${facility.name}: ${error.message}`, { stack: error.stack });
    throw error;
  }
};

/**
 * Ensures a facility has fresh, non-expired QR codes.
 * Call this before returning facility details to Admin.
 * @param {Object} facility 
 * @returns {Promise<Object>} The facility with fresh QRs attached
 */
const ensureFreshQRCodes = async (facility) => {
  const now = new Date();
  
  // If qrNextRotationAt is in the past, or doesn't exist, rotate now
  if (!facility.qrNextRotationAt || facility.qrNextRotationAt <= now) {
    await rotateFacilityQRs(facility);
    // Fetch the updated facility to get the new qrNextRotationAt
    return await Facility.findById(facility._id);
  }
  
  return facility;
};

/**
 * Background task to rotate expired facilities
 */
const runRotationJob = async () => {
  try {
    const now = new Date();
    const facilitiesToRotate = await Facility.find({
      status: "active",
      $or: [
        { qrNextRotationAt: { $lte: now } },
        { qrNextRotationAt: { $exists: false } }
      ]
    });

    if (facilitiesToRotate.length > 0) {
      logger.info(`Cron: Found ${facilitiesToRotate.length} facilities due for rotation`);
      for (const facility of facilitiesToRotate) {
        await rotateFacilityQRs(facility).catch(err => {
          logger.error(`Cron rotation failed for ${facility.name}: ${err.message}`);
        });
      }
    }
  } catch (error) {
    logger.error(`Background rotation job failed: ${error.message}`);
  }
};

/**
 * Schedules the rotation cron job (runs every 30 seconds)
 */
const scheduleRotationJob = () => {
  logger.info("Scheduling dynamic QR rotation job (every 30 seconds)");
  cron.schedule("*/30 * * * * *", runRotationJob);
};

module.exports = {
  rotateFacilityQRs,
  ensureFreshQRCodes,
  scheduleRotationJob,
  runRotationJob
};
