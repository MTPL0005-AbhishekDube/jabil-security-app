const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
    },
    deviceInfo: {
      manufacturer: String,
      model: String,
      osVersion: String,
      platform: {
        type: String,
        enum: ["android", "ios"],
        required: true,
      },
      appVersion: String,
      deviceName: String,
    },
    currentFacility: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Facility",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "inactive",
    },
    lastEnrollment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Enrollment",
    },
    lastActivity: {
      type: Date,
      default: Date.now,
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

// Indexes
deviceSchema.index({ deviceId: 1 });
deviceSchema.index({ status: 1 });
deviceSchema.index({ currentFacility: 1 });
// Method to update last activity
deviceSchema.methods.updateActivity = async function () {
  this.lastActivity = new Date();
  await this.save();
};

module.exports = mongoose.model("Device", deviceSchema);
