require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const axios = require('axios');
const { scheduleDailyJob } = require('./services/dailyQRService');

// Import routes
const enrollmentRoutes = require('./routes/enrollment.routes');
const facilityRoutes = require("./routes/facility.routes");

// Import middleware
const errorHandler = require('./middleware/errorHandler');

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// API routes
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/facilities', facilityRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

// Error handler middleware (should be last)
app.use(errorHandler);

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
    
    // Start server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);

      // Self-Ping to keep Render free tier alive (Every 14 mins)
      if (process.env.RENDER_EXTERNAL_URL) {
        console.log('Keep-Alive service started');
        setInterval(() => {
          axios.get(`${process.env.RENDER_EXTERNAL_URL}/health`)
            .then(() => console.log('Self-ping success'))
            .catch(e => console.error('Self-ping failed:', e.message));
        }, 14 * 60 * 1000); // 14 minutes
      }

      // Start daily QR rotation + emailer
      scheduleDailyJob();
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
});
