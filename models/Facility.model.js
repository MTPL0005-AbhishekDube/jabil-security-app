const mongoose = require("mongoose");

const facilitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Facility name is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    location: {
      address: String,
      city: String,
      state: String,
      country: String,
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
    },
    timezone: {
      type: String,
      trim: true,
    },
    qrExpirationValue: {
      type: Number,
      default: 30,
      min: [1, "Value must be at least 1"],
    },
    qrExpirationUnit: {
      type: String,
      enum: ["seconds", "minutes", "hours", "days"],
      default: "seconds",
    },
    nextRotationAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    entryCode: {
      type: String,
      match: /^\d{6}$/,
    },
    entryCodeValidUntil: {
      type: Date,
    },
    exitCode: {
      type: String,
      match: /^\d{6}$/,
    },
    exitCodeValidUntil: {
      type: Date,
    },
    lastCodeRotatedAt: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
facilitySchema.index({ status: 1 });
facilitySchema.index({ name: 1 });
facilitySchema.index({ nextRotationAt: 1 });

module.exports = mongoose.model("Facility", facilitySchema);
