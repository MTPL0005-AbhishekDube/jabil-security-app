const Device = require("../models/Device.model");
const Enrollment = require("../models/Enrollment.model");
const Facility = require("../models/Facility.model");

// @desc    Admin: list active devices (search by deviceId/visitorId/model)
// @route   GET /api/admin/v2/devices/active
exports.listActiveDevices = async (req, res) => {
  try {
    const { page = 1, limit = 10, q, date } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    // Find facilities created by this admin
    const adminFacilities = await Facility.find({ createdBy: req.admin?._id }).select("_id");
    const facilityIds = adminFacilities.map(f => f._id);

    // Filter for basic search
    const searchFilter = {};
    if (q) {
      const regex = new RegExp(q, "i");
      searchFilter.$or = [
        { deviceId: regex },
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
      { $match: searchFilter },
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
    ];

    // If q is provided, search in lastEnrollmentDoc as well
    if (q) {
      const regex = new RegExp(q, "i");
      pipeline.push({
        $match: {
          $or: [
            { deviceId: regex },
            { "deviceInfo.deviceName": regex },
            { "deviceInfo.model": regex },
            { "lastEnrollmentDoc.visitorId": regex },
          ],
        },
      });
    }

    pipeline.push(
      // Filter by ownership: either current facility or last enrollment facility belongs to this admin
      {
        $match: {
          $or: [
            { currentFacility: { $in: facilityIds } },
            { "lastEnrollmentDoc.facilityId": { $in: facilityIds } }
          ]
        }
      },
      {
        $addFields: {
          visitorId: "$lastEnrollmentDoc.visitorId",
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
    );

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
                let: { cf: "$currentFacility", lf: "$lastEnrollmentDoc.facilityId" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$_id", { $ifNull: ["$$cf", "$$lf"] }]
                      }
                    }
                  }
                ],
                as: "facilityDoc",
              },
            },
            {
              $unwind: {
                path: "$facilityDoc",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $addFields: {
                currentFacility: {
                  $cond: [
                    { $ifNull: ["$facilityDoc", false] },
                    {
                      _id: "$facilityDoc._id",
                      name: "$facilityDoc.name",
                    },
                    null,
                  ],
                },
              },
            },
            {
              $project: {
                lastEnrollmentDoc: 0,
                facilityDoc: 0,
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
exports.getEnrollmentDetails = async (req, res) => {
  try {
    const { deviceId, id, enrollmentId } = req.query;

    const enrollmentIdToUse = id || enrollmentId;

    if (!deviceId || !enrollmentIdToUse) {
      return res.status(400).json({
        status: "error",
        message: "deviceId and enrollment id are required",
      });
    }

    const [device, enrollment] = await Promise.all([
      Device.findOne({ deviceId }).select("deviceId deviceInfo status"),
      Enrollment.findById(enrollmentIdToUse)
        .select(
          "deviceId facilityId visitorId entryQRCode exitQRCode enrolledAt unenrolledAt"
        )
        .populate("facilityId")
        .populate("entryQRCode")
        .populate("exitQRCode"),
    ]);

    if (!device) {
      return res.status(404).json({
        status: "error",
        message: "Device not found",
      });
    }

    if (
      !enrollment ||
      enrollment.deviceId?.toString() !== device._id?.toString()
    ) {
      return res.status(404).json({
        status: "error",
        message: "No active enrollment for this device",
      });
    }

    // Check if the facility belongs to the admin
    if (enrollment.facilityId && enrollment.facilityId.createdBy?.toString() !== req.admin?._id?.toString()) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to view this enrollment details",
      });
    }

    return res.status(200).json({
      status: "success",
      data: {
        id: enrollment._id,
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
              type: enrollment.entryQRCode.type,
            }
          : null,
        enrolledAt: enrollment.enrolledAt,
        ...(enrollment.unenrolledAt
          ? { unenrolledAt: enrollment.unenrolledAt }
          : {}),
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
