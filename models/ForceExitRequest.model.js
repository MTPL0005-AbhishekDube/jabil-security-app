const mongoose = require("mongoose");

const forceExitRequestSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Device",
      required: true,
    },
    visitorId: {
      type: String,
      required: true,
    },
    facilityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Facility",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "denied", "completed"],
      default: "pending",
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    approvedAt: {
      type: Date,
    },
    deniedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    deniedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    adminNotes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    pushNotificationSent: {
      type: Boolean,
      default: false,
    },
    pushNotificationSentAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
forceExitRequestSchema.index({ deviceId: 1, status: 1 });
forceExitRequestSchema.index({ status: 1, requestedAt: -1 });
forceExitRequestSchema.index({ facilityId: 1, status: 1 });

// Ensure only one pending request per device
forceExitRequestSchema.index({ deviceId: 1, status: 1 }, {
  unique: true,
  partialFilterExpression: { status: "pending" },
});

// Method to approve request
forceExitRequestSchema.methods.approve = async function(adminId, notes) {
  this.status = "approved";
  this.approvedAt = new Date();
  this.approvedBy = adminId;
  this.adminNotes = notes;
  return this.save();
};

// Method to deny request
forceExitRequestSchema.methods.deny = async function(adminId, notes) {
  this.status = "denied";
  this.deniedAt = new Date();
  this.deniedBy = adminId;
  this.adminNotes = notes;
  return this.save();
};

// Method to mark as completed
forceExitRequestSchema.methods.complete = async function() {
  this.status = "completed";
  this.completedAt = new Date();
  return this.save();
};

// Static method to check if device has pending request
forceExitRequestSchema.statics.hasPendingRequest = async function(deviceId) {
  const count = await this.countDocuments({
    deviceId,
    status: "pending",
  });
  return count > 0;
};

// Static method to get pending requests for admin
forceExitRequestSchema.statics.getPendingRequestsList = async function(facilityId = null) {
  const query = { status: "pending" };
  if (facilityId) {
    query.facilityId = facilityId;
  }
  
  return this.find(query)
    .populate("deviceId", "deviceId deviceInfo visitorId pushToken")
    .populate("facilityId", "name location")
    .sort({ requestedAt: -1 });
};

module.exports = mongoose.model("ForceExitRequest", forceExitRequestSchema);
