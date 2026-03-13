const { v4: uuidv4 } = require("uuid");
const Facility = require("../models/Facility.model");
const { generateDailyQRsForFacility } = require("../services/dailyQRService");
const {
  findFacilityById,
  attachActiveQRCodes,
  detachDevicesAndEnrollments,
} = require("../services/facilityService");
const { safeUnlink } = require("../utils/file");
const QRCodeModel = require("../models/QRCode.model");

// @desc    Admin: create facility
// @route   POST /api/admin/facilities
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
      createdBy: req.admin?._id,
    });

    let qrResult = null;
    try {
      qrResult = await generateDailyQRsForFacility(facility, new Date());
    } catch (qrErr) {
      console.error("facility create (admin): QR generation failed:", qrErr);
    }

    return res.status(201).json({
      status: "success",
      message:
        qrResult && qrResult.entry && qrResult.exit
          ? "Facility created; today's entry/exit QRs generated"
          : "Facility created (QR generation skipped/failed)",
      data: { facility, qrs: qrResult },
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Admin: list facilities with pagination/search
// @route   GET /api/admin/facilities
exports.getAllFacilities = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, q } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { facilityId: { $regex: q, $options: "i" } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Facility.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Facility.countDocuments(filter),
    ]);

    const itemsWithQrs = await attachActiveQRCodes(items, req);

    return res.status(200).json({
      status: "success",
      data: {
        items: itemsWithQrs,
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

// @desc    Admin: get facility detail
// @route   GET /api/admin/facilities/:id
exports.getFacilityById = async (req, res) => {
  try {
    const { id } = req.params;
    const facility = await findFacilityById(id);

    if (!facility) {
      return res
        .status(404)
        .json({ status: "error", message: "Facility not found" });
    }

    const [facilityWithQrs] = await attachActiveQRCodes([facility], req);

    return res
      .status(200)
      .json({ status: "success", data: facilityWithQrs || facility });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Admin: update facility
// @route   PUT /api/admin/facilities/:id
exports.updateFacility = async (req, res) => {
  try {
    const { id } = req.params;
    const facility = await findFacilityById(id);

    if (!facility) {
      return res
        .status(404)
        .json({ status: "error", message: "Facility not found" });
    }

    const allowed = [
      "name",
      "description",
      "location",
      "notificationEmails",
      "timezone",
      "status",
    ];
    allowed.forEach((field) => {
      if (field in req.body) {
        facility[field] = req.body[field];
      }
    });
    facility.updatedAt = new Date();

    // normalize emails
    if ("notificationEmails" in req.body) {
      let emails = [];
      const notificationEmails = req.body.notificationEmails;
      if (Array.isArray(notificationEmails) && notificationEmails.length) {
        emails = notificationEmails
          .map((e) => String(e).trim())
          .filter(Boolean);
      } else if (typeof notificationEmails === "string" && notificationEmails) {
        emails = notificationEmails
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean);
      }
      facility.notificationEmails = emails;
    }

    await facility.save();

    return res
      .status(200)
      .json({ status: "success", message: "Facility updated", data: facility });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

// @desc    Admin: delete facility (hard delete)
// @route   DELETE /api/admin/facilities/:id
exports.deleteFacility = async (req, res) => {
  try {
    const { id } = req.params;
    const facility = await findFacilityById(id);

    if (!facility) {
      return res
        .status(404)
        .json({ status: "error", message: "Facility not found" });
    }

    // Unlock/detach devices and delete enrollments
    await detachDevicesAndEnrollments(facility._id);

    // Remove QR images + records tied to this facility
    const facilityQRCodes = await QRCodeModel.find({
      facilityId: facility._id,
    });

    for (const qr of facilityQRCodes) {
      await safeUnlink(qr.imagePath);
    }
    await QRCodeModel.deleteMany({ facilityId: facility._id });

    await facility.deleteOne();

    return res.status(200).json({
      status: "success",
      message: "Facility deleted",
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
