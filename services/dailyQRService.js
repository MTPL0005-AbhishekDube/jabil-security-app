const fs = require("fs").promises;
const cron = require("node-cron");
const Facility = require("../models/Facility.model");
const QRCode = require("../models/QRCode.model");
const Device = require("../models/Device.model");
const Enrollment = require("../models/Enrollment.model");
const qrGenerator = require("../utils/qrGenerator");
const { sendEmail, buildDailyQREmail } = require("../utils/emailService");
const mdmService = require("../utils/mdmService");

// Helper: delete file safely
const safeUnlink = async (filePath) => {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
};

// Generate entry & exit QR for a facility for a given date (YYYY-MM-DD)
async function generateDailyQRsForFacility(facility, dateStr) {
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

  // Expire and remove any existing QR for that facility for previous dates
  const oldQrs = await QRCode.find({
    facilityId: facility._id,
    validUntil: { $lt: dayStart },
  });

  for (const qr of oldQrs) {
    // expire status
    qr.status = "expired";
    await qr.save();

    if (qr.imagePath) await safeUnlink(qr.imagePath);
  }

  // Remove old QR records entirely (retention 0 days as per requirement)
  await QRCode.deleteMany({
    facilityId: facility._id,
    validUntil: { $lt: dayStart },
  });

  // Generate validity window (1 day)
  const validFrom = dayStart;
  const validUntil = dayEnd;

  // Entry QR
  const entry = await qrGenerator.generateCompleteQRCode("lock", facility._id, {
    location: facility.name,
    type: "entry",
  });

  const entryDoc = await QRCode.create({
    qrCodeId: entry.qrCodeId,
    facilityId: facility._id,
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
    }
  );

  const exitDoc = await QRCode.create({
    qrCodeId: exit.qrCodeId,
    facilityId: facility._id,
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
        subject: `[Daily QR] ${facility.name} — ${dateStr}`,
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
      console.error("Daily QR email failed:", err.message);
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

// Run daily job at 00:05 server time (can be aligned per facility TZ later)
function scheduleDailyJob() {
  const cronExp = process.env.DAILY_QR_CRON || "0 12 * * *"; // default 12:00 daily
  const timezone = process.env.DAILY_QR_TZ || "UTC";

  cron.schedule(
    cronExp,
    async () => {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

      const facilities = await Facility.find({ status: "active" });

      for (const facility of facilities) {
        await expireActiveEnrollmentsForFacility(facility._id, now);
        await generateDailyQRsForFacility(facility, dateStr);
      }
    },
    { timezone }
  );
}

module.exports = {
  scheduleDailyJob,
  generateDailyQRsForFacility,
  expireActiveEnrollmentsForFacility,
};
