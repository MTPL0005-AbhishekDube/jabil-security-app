const mongoose = require('mongoose');

const qrCodeSchema = new mongoose.Schema({
  qrCodeId: {
    type: String,
    required: true,
    unique: true
  },
  facilityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Facility',
    required: true
  },
  facilityName: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['entry', 'exit', 'emergency'],
    required: true
  },
  action: {
    type: String,
    enum: ['lock', 'unlock', 'emergency_unlock'],
    required: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  url: {
    type: String,
    required: true
  },
  imagePath: {
    type: String
  },
  metadata: {
    location: String,
    entranceName: String,
    description: String
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'expired', 'revoked'],
    default: 'active'
  },
  validFrom: {
    type: Date,
    default: Date.now
  },
  validUntil: {
    type: Date,
    required: true
  },
  generatedForDate: {
    type: String // YYYY-MM-DD
  },
  scanCount: {
    type: Number,
    default: 0
  },
  lastScannedAt: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes (omit duplicates of unique/index fields)
qrCodeSchema.index({ facilityId: 1, type: 1 });
qrCodeSchema.index({ status: 1 });
qrCodeSchema.index({ validUntil: 1 });

// Method to check if QR code is valid
qrCodeSchema.methods.isValid = function() {
  const now = new Date();
  return (
    this.status === 'active' &&
    this.validFrom <= now &&
    this.validUntil >= now
  );
};

// Method to increment scan count
qrCodeSchema.methods.recordScan = async function() {
  this.scanCount += 1;
  this.lastScannedAt = new Date();
  await this.save();
};

module.exports = mongoose.model('QRCode', qrCodeSchema);
