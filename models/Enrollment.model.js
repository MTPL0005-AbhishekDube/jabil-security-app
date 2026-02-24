const mongoose = require("mongoose");

const enrollmentSchema = new mongoose.Schema(
  {
    enrollmentId: {
      type: String,
      required: true,
      unique: true,
    },
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
    },
    facilityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Facility",
      required: true,
    },
    entryQRCode: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QRCode",
    },
    exitQRCode: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QRCode",
    },
    enrolledAt: {
      type: Date,
      default: Date.now,
    },
    unenrolledAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["active", "completed", "expired", "forced_exit", "emergency_exit"],
      default: "active",
    },
    initiatedBy: {
      type: String,
      trim: true,
    },
    reason: {
      type: String,
      trim: true,
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
enrollmentSchema.index({ enrollmentId: 1 });
enrollmentSchema.index({ deviceId: 1 });
enrollmentSchema.index({ facilityId: 1 });
enrollmentSchema.index({ status: 1 });
enrollmentSchema.index({ enrolledAt: 1 });
enrollmentSchema.index({ unenrolledAt: 1 });

// Method to complete enrollment
enrollmentSchema.methods.complete = async function (exitQRCode) {
  this.status = "completed";
  this.unenrolledAt = new Date();
  this.exitQRCode = exitQRCode;

  await this.save();
};

module.exports = mongoose.model("Enrollment", enrollmentSchema);
