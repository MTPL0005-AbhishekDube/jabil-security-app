const mongoose = require("mongoose");

const facilityAccessCodeSchema = new mongoose.Schema(
  {
    facilityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Facility",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["entry", "exit"],
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      match: /^\d{6}$/,
    },
    validFrom: {
      type: Date,
      required: true,
      default: Date.now,
    },
    validUntil: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

facilityAccessCodeSchema.index({ facilityId: 1, type: 1, validUntil: -1 });
facilityAccessCodeSchema.index({ facilityId: 1, type: 1, code: 1, validUntil: -1 });

// Keep records briefly for auditing/debugging, then let Mongo clean up automatically.
facilityAccessCodeSchema.index({ validUntil: 1 }, { expireAfterSeconds: 120 });

module.exports = mongoose.model("FacilityAccessCode", facilityAccessCodeSchema);