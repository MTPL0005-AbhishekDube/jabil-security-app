const express = require("express");
const router = express.Router();
const { createFacility } = require("../controllers/facility.controller");

// facility creation
router.post("/create-facility", createFacility);

module.exports = router;
