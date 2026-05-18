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
      deviceName: String,
    },
    pushToken: {
      type: String,
      trim: true,
    },
    currentFacility: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Facility",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
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

// Indexes (omit deviceId because unique already creates it)
deviceSchema.index({ status: 1 });
deviceSchema.index({ currentFacility: 1 });
// Method to update last activity
deviceSchema.methods.updateActivity = async function () {
  this.lastActivity = new Date();
  await this.save();
};

module.exports = mongoose.model("Device", deviceSchema);
