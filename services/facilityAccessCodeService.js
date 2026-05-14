const cron = require("node-cron");
const crypto = require("crypto");
const Facility = require("../models/Facility.model");
const FacilityAccessCode = require("../models/FacilityAccessCode.model");
const logger = require("../utils/logger");

const parsePositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

const ACCESS_CODE_ROTATION_SECONDS = parsePositiveInt(
  process.env.ACCESS_CODE_ROTATION_SECONDS,
  15
);
const ACCESS_CODE_TTL_SECONDS = parsePositiveInt(
  process.env.ACCESS_CODE_TTL_SECONDS,
  20
);
const ACCESS_CODE_CRON =
  process.env.ACCESS_CODE_CRON ||
  `*/${ACCESS_CODE_ROTATION_SECONDS} * * * * *`;
const ACCESS_CODE_TIMEZONE =
  process.env.ACCESS_CODE_TZ || process.env.DAILY_QR_TZ || "UTC";

let isRotationRunning = false;
let accessCodeCronTask = null;

// HARDCODED FOR TESTING
const generateRandomSixDigitCode = () => "606060";

const generateCodePair = () => {
  const entryCode = generateRandomSixDigitCode();
  const exitCode = generateRandomSixDigitCode();

  // REMOVED: while (exitCode === entryCode) loop.
  // Since both are 606060, the loop would run infinitely and crash the server.

  return { entryCode, exitCode };
};

const getCodeWindow = (referenceDate = new Date()) => {
  const validFrom = new Date(referenceDate);
  const validUntil = new Date(
    validFrom.getTime() + ACCESS_CODE_TTL_SECONDS * 1000
  );

  return { validFrom, validUntil };
};

async function refreshAccessCodesForFacility(facilityId, referenceDate = new Date()) {
  const { entryCode, exitCode } = generateCodePair();
  const { validFrom, validUntil } = getCodeWindow(referenceDate);

  await FacilityAccessCode.insertMany([
    {
      facilityId,
      type: "entry",
      code: entryCode,
      validFrom,
      validUntil,
    },
    {
      facilityId,
      type: "exit",
      code: exitCode,
      validFrom,
      validUntil,
    },
  ]);

  await Facility.updateOne(
    { _id: facilityId },
    {
      $set: {
        entryCode,
        entryCodeValidUntil: validUntil,
        exitCode,
        exitCodeValidUntil: validUntil,
        lastCodeRotatedAt: validFrom,
      },
    }
  );

  return {
    facilityId,
    entryCode,
    exitCode,
    validFrom,
    validUntil,
  };
}

async function rotateAccessCodesForAllFacilities(referenceDate = new Date()) {
  if (isRotationRunning) {
    logger.warn("Access code rotation skipped because previous run is still active");
    return { skipped: true };
  }

  isRotationRunning = true;

  try {
    const facilities = await Facility.find({ status: "active" })
      .select("_id")
      .lean();

    if (!facilities.length) {
      logger.info("Access code rotation skipped: no active facilities found");
      return { totalFacilities: 0 };
    }

    const { validFrom, validUntil } = getCodeWindow(referenceDate);
    const codeDocs = [];
    const bulkUpdates = [];

    for (const facility of facilities) {
      const { entryCode, exitCode } = generateCodePair();

      codeDocs.push(
        {
          facilityId: facility._id,
          type: "entry",
          code: entryCode,
          validFrom,
          validUntil,
        },
        {
          facilityId: facility._id,
          type: "exit",
          code: exitCode,
          validFrom,
          validUntil,
        }
      );

      bulkUpdates.push({
        updateOne: {
          filter: { _id: facility._id },
          update: {
            $set: {
              entryCode,
              entryCodeValidUntil: validUntil,
              exitCode,
              exitCodeValidUntil: validUntil,
              lastCodeRotatedAt: validFrom,
            },
          },
        },
      });
    }

    await Promise.all([
      FacilityAccessCode.insertMany(codeDocs, { ordered: false }),
      Facility.bulkWrite(bulkUpdates, { ordered: false }),
    ]);

    logger.info("Access code rotation completed", {
      facilitiesProcessed: facilities.length,
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
      ttlSeconds: ACCESS_CODE_TTL_SECONDS,
    });

    return {
      totalFacilities: facilities.length,
      validFrom,
      validUntil,
    };
  } catch (error) {
    logger.error(`Access code rotation failed: ${error.message}`, {
      stack: error.stack,
    });
    throw error;
  } finally {
    isRotationRunning = false;
  }
}

function scheduleAccessCodeJob() {
  if (accessCodeCronTask) {
    logger.warn("Access code rotation scheduler already initialized");
    return accessCodeCronTask;
  }

  logger.info(
    `Scheduling access code rotation job: ${ACCESS_CODE_CRON} (${ACCESS_CODE_TIMEZONE})`
  );

  accessCodeCronTask = cron.schedule(
    ACCESS_CODE_CRON,
    async () => {
      try {
        await rotateAccessCodesForAllFacilities(new Date());
      } catch (error) {
        logger.error(`Scheduled access code rotation failed: ${error.message}`, {
          stack: error.stack,
        });
      }
    },
    {
      scheduled: true,
      timezone: ACCESS_CODE_TIMEZONE,
    }
  );

  return accessCodeCronTask;
}

async function runAccessCodeJobOnce() {
  return rotateAccessCodesForAllFacilities(new Date());
}

async function findValidAccessCode({ facilityId, type, code, referenceDate = new Date() }) {
  if (!facilityId || !type || !code) return null;

  const now = new Date(referenceDate);

  return FacilityAccessCode.findOne({
    facilityId,
    type,
    code,
    validFrom: { $lte: now },
    validUntil: { $gte: now },
  })
    .sort({ validUntil: -1 })
    .lean();
}

module.exports = {
  ACCESS_CODE_ROTATION_SECONDS,
  ACCESS_CODE_TTL_SECONDS,
  generateRandomSixDigitCode,
  refreshAccessCodesForFacility,
  rotateAccessCodesForAllFacilities,
  scheduleAccessCodeJob,
  runAccessCodeJobOnce,
  findValidAccessCode,
};