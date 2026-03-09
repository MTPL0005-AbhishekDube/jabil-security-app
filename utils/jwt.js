const jwt = require("jsonwebtoken");

// Generate QR token with specific data
exports.generateQRToken = (data) => {
  const payload = {
    ...data,
    type: "qr_token",
    timestamp: Date.now(),
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.QR_TOKEN_EXPIRE,
  });
};

// Generate restore token for push flows (short-lived)
exports.generateRestoreToken = (data = {}) => {
  const payload = {
    ...data,
    type: "restore_token",
    timestamp: Date.now(),
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.RESTORE_TOKEN_EXPIRE || "2h",
  });
};

exports.verifyRestoreToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "restore_token") {
      throw new Error("Invalid token type");
    }
    return decoded;
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
};

// Verify token
exports.verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
};
