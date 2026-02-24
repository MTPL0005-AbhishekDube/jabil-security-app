const jwt = require('jsonwebtoken');

// Generate QR token with specific data
exports.generateQRToken = (data) => {
  const payload = {
    ...data,
    type: 'qr_token',
    timestamp: Date.now()
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.QR_TOKEN_EXPIRE
  });
};

// Verify token
exports.verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
};
