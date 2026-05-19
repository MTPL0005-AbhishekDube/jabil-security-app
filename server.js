require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const {
  scheduleRotationJob,
  runRotationJob,
} = require("./services/qrRotationService");
const {
  scheduleAccessCodeJob,
  runAccessCodeJobOnce,
} = require("./services/facilityAccessCodeService");
const logger = require("./utils/logger");

// Import routes
const enrollmentRoutes = require("./routes/enrollment.routes");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const forceExitRoutes = require("./routes/forceExit.routes");

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
app.use("/qr-code-images", express.static(path.join(__dirname, "qr-code-images")));

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
app.use("/api/force-exit", forceExitRoutes);

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
    const PORT = process.env.PORT || 5001;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);

      // Start dynamic QR rotation
      logger.info("Initializing dynamic QR rotation system...");
      scheduleRotationJob();

      // Start short-lived facility access code rotation (6-digit entry/exit codes)
      logger.info("Initializing facility access code rotation system...");
      scheduleAccessCodeJob();

      // Ensure fresh QR codes exist immediately on boot
      logger.info("Running initial rotation job on startup...");
      runRotationJob().catch((err) => {
        logger.error("Startup rotation job failed: " + err.message, { stack: err.stack });
      });

      // Ensure first 6-digit codes are available immediately on boot
      logger.info("Running initial access code job on startup...");
      runAccessCodeJobOnce().catch((err) => {
        logger.error("Startup access code job failed: " + err.message, {
          stack: err.stack,
        });
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
