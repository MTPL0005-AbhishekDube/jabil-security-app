const { v4: uuidv4 } = require("uuid");
const Facility = require("../models/Facility.model");

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

    // Normalize emails
    const emails =
      Array.isArray(notificationEmails) && notificationEmails.length
        ? notificationEmails.map((e) => String(e).trim()).filter(Boolean)
        : [];

    const facility = await Facility.create({
      facilityId: uuidv4(),
      name,
      description,
      location,
      notificationEmails: emails,
      timezone,
      status,
    });

    res.status(201).json({
      status: "success",
      message: "Facility created successfully",
      data: {
        facility,
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
