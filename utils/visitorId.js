const Enrollment = require("../models/Enrollment.model");
const mongoose = require("mongoose");

// Generate the next visitor id for a specific facility in the format Visitor-1, Visitor-2, ...
exports.generateNextVisitorId = async (facilityId) => {
  const latest = await Enrollment.aggregate([
    {
      $match: {
        facilityId: new mongoose.Types.ObjectId(facilityId),
        visitorId: { $regex: /^Visitor-\d+$/i },
      },
    },
    {
      $addFields: {
        visitorNum: {
          $toInt: {
            $arrayElemAt: [{ $split: ["$visitorId", "-"] }, 1],
          },
        },
      },
    },
    { $sort: { visitorNum: -1 } },
    { $limit: 1 },
    { $project: { visitorNum: 1 } },
  ]);

  const lastNum = latest?.[0]?.visitorNum || 0;
  return `Visitor-${lastNum + 1}`;
};
