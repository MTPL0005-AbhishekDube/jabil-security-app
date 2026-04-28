const Device = require("../models/Device.model");
const Enrollment = require("../models/Enrollment.model");

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

// @desc    Admin: list active devices (search by deviceId/visitorId/model)
// @route   GET /api/admin/v2/devices/active
exports.listActiveDevicesV2 = async (req, res) => {
  try {
    const { page = 1, limit = 10, q, date } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (q) {
      const regex = new RegExp(q, "i");
      filter.$or = [
        { deviceId: regex },
        { visitorId: regex },
        { "deviceInfo.deviceName": regex },
        { "deviceInfo.model": regex },
      ];
    }

    let enrolledDateMatch = null;
    if (date) {
      const rawDate = String(date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        return res.status(400).json({
          status: "error",
          message: "date must be in YYYY-MM-DD format",
        });
      }

      const dayStart = new Date(`${rawDate}T00:00:00.000Z`);
      const dayEnd = new Date(`${rawDate}T23:59:59.999Z`);
      if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime())) {
        return res.status(400).json({
          status: "error",
          message: "date must be in YYYY-MM-DD format",
        });
      }

      enrolledDateMatch = {
        "lastEnrollmentDoc.enrolledAt": {
          $gte: dayStart,
          $lte: dayEnd,
        },
      };
    }

    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: "enrollments",
          localField: "lastEnrollment",
          foreignField: "_id",
          as: "lastEnrollmentDoc",
        },
      },
      {
        $unwind: {
          path: "$lastEnrollmentDoc",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          enrolledAt: "$lastEnrollmentDoc.enrolledAt",
          unenrolledAt: {
            $cond: [
              { $eq: ["$status", "inactive"] },
              "$lastEnrollmentDoc.unenrolledAt",
              "$$REMOVE",
            ],
          },
        },
      },
    ];

    if (enrolledDateMatch) {
      pipeline.push({ $match: enrolledDateMatch });
    }

    pipeline.push(
      {
        $sort: {
          enrolledAt: -1,
          updatedAt: -1,
        },
      },
      {
        $facet: {
          items: [
            { $skip: skip },
            { $limit: limitNum },
            {
              $lookup: {
                from: "facilities",
                localField: "currentFacility",
                foreignField: "_id",
                as: "currentFacilityDoc",
              },
            },
            {
              $unwind: {
                path: "$currentFacilityDoc",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $addFields: {
                currentFacility: {
                  $cond: [
                    { $ifNull: ["$currentFacilityDoc", false] },
                    {
                      _id: "$currentFacilityDoc._id",
                      name: "$currentFacilityDoc.name",
                      facilityId: "$currentFacilityDoc.facilityId",
                    },
                    null,
                  ],
                },
              },
            },
            {
              $project: {
                lastEnrollmentDoc: 0,
                currentFacilityDoc: 0,
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      }
    );

    const [result] = await Device.aggregate(pipeline);
    const items = result?.items || [];
    const total = result?.total?.[0]?.count || 0;

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
