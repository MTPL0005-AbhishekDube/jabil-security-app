const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const {
  createFacility,
  getAllFacilities,
  getFacilityById,
  updateFacility,
  deleteFacility,
} = require("../controllers/facility.controller");
const {
  listActiveDevices,
  listActiveDevicesV2,
  getActiveDeviceById,
} = require("../controllers/device.controller");
const {
  getAllAdminsList,
  getAdminById,
} = require("../controllers/admin.controller");

// Protect all admin routes
router.use(auth);

// Admin users
router.get("/admins", getAllAdminsList);
router.get("/admins/:id", getAdminById);

// Facility CRUD only for (admin)
router.post("/facilities", createFacility);
router.get("/facilities", getAllFacilities);
router.get("/facilities/:id", getFacilityById);
router.put("/facilities/:id", updateFacility);
router.delete("/facilities/:id", deleteFacility);

// Devices (admin)

// @desc list of all active devices
// @route   GET /api/admin/devices/active
router.get("/devices/active", listActiveDevices);

router.get("/v2/devices/active", listActiveDevicesV2);

// @desc    Get active enrollment by device ID
// @route   GET /api/admin/devices/:deviceId/active-enrollment
router.get("/devices/:deviceId/active-enrollment", getActiveDeviceById);

module.exports = router;
