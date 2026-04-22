require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const axios = require("axios");
const {
  scheduleDailyJob,
  runDailyJobOnce,
} = require("./services/dailyQRService");
const logger = require("./utils/logger");

// Import routes
const enrollmentRoutes = require("./routes/enrollment.routes");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");

// Import middleware
const errorHandler = require("./middleware/errorHandler");
const requestId = require("./middleware/requestId");

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    credentials: true,
  })
);

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID middleware (should be before other middleware)
app.use(requestId);

// Logging middleware
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

// Static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/enrollments", enrollmentRoutes);
app.use("/api/admin", adminRoutes);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found",
  });
});

// Error handler middleware (should be last)
app.use(errorHandler);

// Database connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected successfully");

    // Start server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);

      // Start daily QR rotation + emailer
      logger.info("Initializing daily QR generation system...");
      scheduleDailyJob();

      // Ensure today's QR codes exist immediately on boot
      logger.info("Running initial daily job on startup...");
      runDailyJobOnce().catch((err) => {
        logger.error("Startup daily job failed: " + err.message, { stack: err.stack });
      });

      // Schedule log cleanup (runs daily at 2 AM)
      logger.scheduleLogCleanup();
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
});
