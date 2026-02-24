const mongoose = require("mongoose");

const facilitySchema = new mongoose.Schema(
  {
    facilityId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
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

    notificationEmails: {
      type: [String],
      default: [],
    },
    timezone: {
      type: String,
      default: 'UTC',
      trim: true,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "maintenance"],
      default: "active",
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
facilitySchema.index({ facilityId: 1 });
facilitySchema.index({ status: 1 });
facilitySchema.index({ name: 1 });

module.exports = mongoose.model("Facility", facilitySchema);
