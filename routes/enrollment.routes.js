const express = require("express");
const router = express.Router();
const {
  scanEntry,
  scanExit,
  forceExitAdmin,
} = require("../controllers/enrollment.controller");

// Public routes (for mobile app)
// @desc    Scan entry QR and enroll device (lock camera)
// @route   POST /api/enrollments/scan-entry
router.post("/scan-entry", scanEntry);

// @desc    Scan exit (unlock camera)
// @route   POST /api/enrollments/scan-exit
router.post("/scan-exit", scanExit);

// Admin route - will be protected by auth middleware when available
router.post("/admin/force-exit", forceExitAdmin);

module.exports = router;
