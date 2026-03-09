const Device = require("../models/Device.model");

// Generate the next visitor id in the format visitor-1, visitor-2, ...
// Supports legacy underscore ids by reading the numeric suffix from either visitor-1 or visitor_1.
exports.generateNextVisitorId = async () => {
  const latest = await Device.aggregate([
    { $match: { visitorId: { $regex: /^visitor[-_]\d+$/i } } },
    {
      $addFields: {
        visitorNum: {
          $toInt: {
            $arrayElemAt: [
              {
                $split: [
                  "$visitorId",
                  {
                    $cond: [
                      { $regexMatch: { input: "$visitorId", regex: /_/ } },
                      "_",
                      "-",
                    ],
                  },
                ],
              },
              1,
            ],
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
