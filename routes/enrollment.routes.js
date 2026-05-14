const express = require("express");
const router = express.Router();
const {
  scanEntry,
  scanExit,
  scanExitByCode,
} = require("../controllers/enrollment.controller");

// Public routes (for mobile app)
// @desc    Scan entry QR and enroll device (lock camera)
// @route   POST /api/enrollments/scan-entry
router.post("/scan-entry", scanEntry);

// @desc    Scan exit (unlock camera)
// @route   POST /api/enrollments/scan-exit
router.post("/scan-exit", scanExit);

// @desc    Scan exit using 6-digit exit code + facility
// @route   POST /api/enrollments/scan-exit-code
router.post("/scan-exit-code", scanExitByCode);

module.exports = router;
