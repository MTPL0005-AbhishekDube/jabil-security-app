const mongoose = require('mongoose');

const requestId = (req, res, next) => {
  // Generate or use existing request ID
  req.requestId = req.headers['x-request-id'] || new mongoose.Types.ObjectId();
  
  // Add request ID to response headers
  res.setHeader('X-Request-ID', req.requestId);
  
  // Override res.end to log request completion
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
   
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

module.exports = requestId;
