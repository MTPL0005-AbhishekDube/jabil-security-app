const { v4: uuidv4 } = require("uuid");
const Facility = require("../models/Facility.model");
const { generateDailyQRsForFacility } = require("../services/dailyQRService");

// @desc    create a facility (without admin)
// @route   POST /api/facilities/create-facility
exports.createFacility = async (req, res) => {
  try {
    const {
      name,
      description,
      location,
      notificationEmails = [],
      timezone = "UTC",
      status = "active",
    } = req.body;

    if (!name) {
      return res.status(400).json({
        status: "error",
        message: "name is required",
      });
    }

    // Normalize emails (accept array or comma-separated string)
    let emails = [];
    if (Array.isArray(notificationEmails) && notificationEmails.length) {
      emails = notificationEmails.map((e) => String(e).trim()).filter(Boolean);
    } else if (typeof notificationEmails === "string" && notificationEmails) {
      emails = notificationEmails
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    }

    const facility = await Facility.create({
      facilityId: uuidv4(),
      name,
      description,
      location,
      notificationEmails: emails,
      timezone,
      status,
    });

    // Generate today's entry/exit QRs immediately for this facility
    // so callers don't need to run a separate script for first-day codes.
    let qrResult = null;
    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
      qrResult = await generateDailyQRsForFacility(facility, today);
    } catch (qrErr) {
      console.error("facility create: QR generation failed:", qrErr);
    }

    res.status(201).json({
      status: "success",
      message:
        qrResult && qrResult.entry && qrResult.exit
          ? `Facility created successfully; today's entry/exit QRs generated and emailed to ${emails.join(
              ", "
            ) || "no recipients (none provided)"}`
          : "Facility created successfully (QR generation skipped/failed)",
      data: {
        facility,
        qrs: qrResult,
      },
    });
  } catch (error) {
    console.error("facility create error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
