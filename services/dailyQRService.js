const cron = require("node-cron");
const Facility = require("../models/Facility.model");
const QRCode = require("../models/QRCode.model");
const Device = require("../models/Device.model");
const Enrollment = require("../models/Enrollment.model");
const qrGenerator = require("../utils/qrGenerator");
const { sendEmail, buildDailyQREmail } = require("../utils/emailService");
const mdmService = require("../utils/mdmService");
const { safeUnlink } = require("../utils/file");
const logger = require("../utils/logger");

// basic slugify for filenames/ids
const slugify = (str) =>
  String(str || "facility")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const RAW_DEFAULT_TZ = process.env.DAILY_QR_TZ || "UTC";
const TZ_ALIASES = {
  IST: "Asia/Kolkata",
};

// Configurable QR validity window (defaults to 90 days)
const getValidityDays = () => {
  const parsed = parseInt(process.env.QR_VALIDITY_DAYS, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 90;
};

const QR_VALIDITY_DAYS = getValidityDays();
const QR_VALIDITY_MS = QR_VALIDITY_DAYS * 24 * 60 * 60 * 1000;

const normalizeTimeZone = (tz) => {
  const candidate = TZ_ALIASES[tz] || tz || "UTC";
  try {
    // Validate timezone
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch (err) {
    console.warn(`Invalid timezone "${tz}" provided; falling back to UTC`);
    return "UTC";
  }
};

const DEFAULT_TZ = normalizeTimeZone(RAW_DEFAULT_TZ);

// Compute date string + start/end of day in the facility's timezone (or env default)
function getDateContext(facility, referenceDate = new Date()) {
  const timeZone = normalizeTimeZone(facility?.timezone || DEFAULT_TZ);

  // YYYY-MM-DD for the facility timezone
  const dateStr = referenceDate.toLocaleDateString("en-CA", { timeZone });

  // Get exact midnight boundaries in the facility's timezone
  const [year, month, day] = dateStr.split("-").map(Number);

  // Start of day: 00:00:00 in facility timezone
  const validFrom = new Date(year, month - 1, day, 0, 0, 0, 0);

  // End of day: 23:59:59.999 in facility timezone (exactly 24 hours later)
  const validUntil = new Date(year, month - 1, day, 23, 59, 59, 999);

  return { timeZone, dateStr, validFrom, validUntil };
}

// Generate entry & exit QR for a facility for a given day (defaults to "today" in facility TZ)
async function generateDailyQRsForFacility(
  facility,
  referenceDate = new Date()
) {
  const { dateStr, validFrom, validUntil } = getDateContext(
    facility,
    referenceDate
  );

  // Step 1: Delete ALL existing QR codes for this facility (regardless of validity)
  // This ensures we have a clean slate for the new day
  logger.info(`Deleting existing QR codes for ${facility.name} for date ${dateStr}`);
  const deletedCount = await QRCode.deleteMany({
    facilityId: facility._id
  });

  if (deletedCount > 0) {
    logger.info(`Deleted ${deletedCount} existing QR codes for ${facility.name}`);
  }

  const slug = slugify(facility.name);

  // Entry QR
  const entry = await qrGenerator.generateCompleteQRCode(
    "lock",
    facility._id,
    {
      location: facility.name,
      type: "entry",
    },
    { qrCodeId: `${slug}_Entry_Code_${dateStr}` }
  );

  const entryDoc = await QRCode.create({
    qrCodeId: entry.qrCodeId,
    facilityId: facility._id,
    facilityName: facility.name,
    type: "entry",
    action: "lock",
    token: entry.token,
    url: entry.url,
    imagePath: entry.imagePath,
    metadata: { location: facility.name, type: "entry" },
    status: "active",
    validFrom,
    validUntil,
    generatedForDate: dateStr,
  });

  // Exit QR
  const exit = await qrGenerator.generateCompleteQRCode(
    "unlock",
    facility._id,
    {
      location: facility.name,
      type: "exit",
    },
    { qrCodeId: `${slug}_Exit_Code_${dateStr}` }
  );

  const exitDoc = await QRCode.create({
    qrCodeId: exit.qrCodeId,
    facilityId: facility._id,
    facilityName: facility.name,
    type: "exit",
    action: "unlock",
    token: exit.token,
    url: exit.url,
    imagePath: exit.imagePath,
    metadata: { location: facility.name, type: "exit" },
    status: "active",
    validFrom,
    validUntil,
    generatedForDate: dateStr,
  });

  // Build email
  if (facility.notificationEmails && facility.notificationEmails.length) {
    const html = buildDailyQREmail({
      facilityName: facility.name,
      date: dateStr,
    });

    try {
      await sendEmail({
        to: facility.notificationEmails,
        subject: `Daily QR ${facility.name} — ${dateStr}`,
        html,
        attachments: [
          {
            filename: `ENTRY-${facility.name}-${dateStr}.png`,
            path: entry.imagePath,
          },
          {
            filename: `EXIT-${facility.name}-${dateStr}.png`,
            path: exit.imagePath,
          },
        ],
      });
    } catch (err) {
      console.error(
        `Daily QR email failed for facility ${facility.name}:`,
        err.message
      );
    }
  }

  return { entry: entryDoc, exit: exitDoc };
}

// Deactivate devices/enrollments when daily QR rotates
async function expireActiveEnrollmentsForFacility(facilityId, cutoff) {
  const activeEnrollments = await Enrollment.find({
    facilityId,
    status: "active",
    enrolledAt: { $lt: cutoff },
  }).populate("deviceId");

  for (const enrollment of activeEnrollments) {
    enrollment.status = "expired";
    enrollment.unenrolledAt = new Date();
    await enrollment.save();

    const device = enrollment.deviceId;
    if (device) {
      // Best-effort unlock before marking inactive
      if (device.deviceId && device.deviceInfo?.platform) {
        await mdmService.unlockCamera(
          device.deviceId,
          device.deviceInfo.platform
        );
      }
      device.status = "inactive";
      device.currentFacility = null;
      device.lastEnrollment = enrollment._id;
      await device.save();
    }
  }
}

// Run daily job at midnight every day for all facilities
function scheduleDailyJob() {
  const cronExp = process.env.DAILY_QR_CRON || "0 0 * * *"; // exactly at midnight
  const timezone = process.env.DAILY_QR_TZ || "Asia/Kolkata";

  logger.info(`Scheduling daily QR generation job: ${cronExp} (${timezone})`);

  cron.schedule(
    cronExp,
    async () => {
      const startTime = new Date();
      logger.info(`Starting daily QR generation job at ${startTime.toISOString()}`);

      try {
        const now = new Date();
        const facilities = await Facility.find({ status: "active" });

        logger.info(`Found ${facilities.length} active facilities to process`);

        let successCount = 0;
        let errorCount = 0;

        for (const facility of facilities) {
          try {
            logger.info(`Processing facility: ${facility.name}`);

            // Step 1: Expire old enrollments and unlock devices from previous day
            await expireActiveEnrollmentsForFacility(facility._id, now);
            logger.info(`Expired old enrollments for ${facility.name}`);

            // Step 2: Generate new QR codes for today (this will delete old ones)
            const result = await generateDailyQRsForFacility(facility, now);
            if (result) {
              logger.info(`Generated new QR codes for ${facility.name}`);
              logger.info(`QR codes valid from ${result.entry.validFrom.toISOString()} to ${result.entry.validUntil.toISOString()}`);
            } else {
              logger.warn(`No QR codes generated for ${facility.name}`);
            }

            successCount++;
          } catch (facilityError) {
            logger.error(`Failed to process facility ${facility.name}: ${facilityError.message}`);
            errorCount++;
          }
        }

        const endTime = new Date();
        const duration = endTime - startTime;

        logger.info(`Daily QR generation job completed in ${duration}ms`);
        logger.info(`Success: ${successCount} facilities`);
        if (errorCount > 0) {
          logger.warn(`Errors: ${errorCount} facilities`);
        }

      } catch (error) {
        logger.error(`Daily QR generation job failed: ${error.message}`, { stack: error.stack });
      }
    },
    {
      timezone,
      scheduled: true
    }
  );

  logger.info(`Daily QR generation job scheduled successfully`);
}

// Generate QR codes only when there isn't an active entry + exit pair for the facility
async function ensureActiveQRCodes(facility, referenceDate = new Date()) {
  const now = new Date(referenceDate);

  const activeQrs = await QRCode.find({
    facilityId: facility._id,
    status: "active",
    validFrom: { $lte: now },
    validUntil: { $gte: now },
  }).lean();

  const hasEntry = activeQrs.some((qr) => qr.type === "entry");
  const hasExit = activeQrs.some((qr) => qr.type === "exit");

  if (hasEntry && hasExit) return null;

  return generateDailyQRsForFacility(facility, referenceDate);
}

// Run once on startup to ensure today's QR codes exist
async function runDailyJobOnce() {
  const now = new Date();
  const facilities = await Facility.find({ status: "active" });
  for (const facility of facilities) {
    await expireActiveEnrollmentsForFacility(facility._id, now);
    await ensureActiveQRCodes(facility, now);
  }
}

module.exports = {
  scheduleDailyJob,
  runDailyJobOnce,
  generateDailyQRsForFacility,
  getDateContext,
  expireActiveEnrollmentsForFacility,
  ensureActiveQRCodes,
};
