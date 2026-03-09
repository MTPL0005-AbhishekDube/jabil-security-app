const Admin = require("../models/Admin.model");
const jwt = require("jsonwebtoken");

const TOKEN_TTL = process.env.ADMIN_TOKEN_EXPIRE || "15d";

const signAdminToken = (admin) =>
  jwt.sign(
    {
      sub: admin._id,
      username: admin.username,
      type: "admin_auth",
    },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );

// POST /api/auth/admin/register
exports.register = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message: "username and password are required",
      });
    }

    const existing = await Admin.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res
        .status(400)
        .json({ status: "error", message: "username already exists" });
    }

    const admin = await Admin.create({ username, password });
    const token = signAdminToken(admin);

    return res.status(201).json({
      status: "success",
      data: {
        token,
        admin: { id: admin._id, username: admin.username },
      },
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message,
    });
  }
};

// POST /api/auth/admin/login
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message: "username and password are required",
      });
    }

    const admin = await Admin.findOne({ username: username.toLowerCase() });
    if (!admin) {
      return res
        .status(401)
        .json({ status: "error", message: "Invalid credentials" });
    }

    const isMatch = await admin.matchPassword(password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ status: "error", message: "Invalid credentials" });
    }

    const token = signAdminToken(admin);
    return res.status(200).json({
      status: "success",
      data: {
        token,
        admin: { id: admin._id, username: admin.username },
      },
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message,
    });
  }
};
