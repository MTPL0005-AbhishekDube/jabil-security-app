const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

class Logger {
  constructor() {
    // Use different log directories for development vs production
    const env = process.env.NODE_ENV || "development";
    if (env === "production") {
      this.logDir = process.env.LOGS_DIR || path.join(__dirname, "../logs");
    } else {
      this.logDir = path.join(__dirname, "../logs");
    }
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaString = Object.keys(meta).length > 0 ? JSON.stringify(meta) : "";
    return `[${timestamp}] ${level.toUpperCase()}: ${message} ${metaString}`;
  }

  writeToFile(level, formattedMessage) {
    const logFile = path.join(this.logDir, `${level}.log`);
    fs.appendFileSync(logFile, formattedMessage + "\n");
  }

  log(level, message, meta = {}) {
    const formattedMessage = this.formatMessage(level, message, meta);

    // Always log to console
    if (level === "error") {
      console.error(formattedMessage);
    } else {
      console.log(formattedMessage);
    }

    // Always write to file (both development and production)
    this.writeToFile(level, formattedMessage);
  }

  info(message, meta = {}) {
    this.log("info", message, meta);
  }

  warn(message, meta = {}) {
    this.log("warn", message, meta);
  }

  error(message, meta = {}) {
    const formattedMessage = this.formatMessage("error", message, meta);

    // Always log to console as error
    console.error(formattedMessage);

    // Always write to file
    this.writeToFile("error", formattedMessage);
  }

  debug(message, meta = {}) {
    if (process.env.NODE_ENV === "development") {
      this.log("debug", message, meta);
    }
  }

  // Specialized logging methods for QR operations
  logQRScan(operation, { deviceId, token, qrCodeId, facilityId, ...meta }) {
    this.info(`QR ${operation} scan initiated`, {
      operation,
      deviceId,
      token: token ? token.substring(0, 20) + "..." : "none",
      qrCodeId,
      facilityId,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  logQRError(
    operation,
    error,
    { deviceId, token, qrCodeId, facilityId, ...meta }
  ) {
    this.error(`QR ${operation} failed`, {
      operation,
      deviceId,
      token: token ? token.substring(0, 20) + "..." : "none",
      qrCodeId,
      facilityId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  logMDMOperation(operation, deviceId, platform, result, meta = {}) {
    if (result.success) {
      this.info(`MDM ${operation} successful`, {
        operation,
        deviceId,
        platform,
        timestamp: new Date().toISOString(),
        ...meta,
      });
    } else {
      this.error(`MDM ${operation} failed`, {
        operation,
        deviceId,
        platform,
        error: result.error,
        timestamp: new Date().toISOString(),
        ...meta,
      });
    }
  }

  logEnrollment(operation, enrollmentData, meta = {}) {
    this.info(`Enrollment ${operation}`, {
      operation,
      enrollmentId: enrollmentData.enrollmentId,
      deviceId: enrollmentData.deviceId,
      facilityId: enrollmentData.facilityId,
      status: enrollmentData.status,
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }

  // Clean up old log files (older than 3 days)
  cleanupOldLogs() {
    try {
      // Ensure log directory exists
      if (!fs.existsSync(this.logDir)) {
        this.debug("Log directory does not exist, skipping cleanup");
        return;
      }

      const logFiles = fs.readdirSync(this.logDir);
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      let deletedCount = 0;
      let totalSize = 0;
      let totalFiles = logFiles.length;

      // Safety check: don't delete if we have fewer than 10 files
      if (totalFiles < 10) {
        this.debug("Skipping cleanup - too few log files", { totalFiles });
        return;
      }

      logFiles.forEach((file) => {
        const filePath = path.join(this.logDir, file);

        try {
          const stats = fs.statSync(filePath);

          // Only delete .log files that are older than 3 days
          if (
            stats.isFile() &&
            file.endsWith(".log") &&
            stats.mtime < threeDaysAgo
          ) {
            // Additional safety: don't delete files larger than 100MB (might be corrupted)
            if (stats.size > 100 * 1024 * 1024) {
              this.warn("Skipping large log file", {
                file,
                size: stats.size,
                reason: "File too large, may be corrupted",
              });
              return;
            }

            totalSize += stats.size;
            fs.unlinkSync(filePath);
            deletedCount++;

            this.info("Old log file deleted", {
              file,
              fileSize: stats.size,
              fileModified: stats.mtime.toISOString(),
              deletedAt: new Date().toISOString(),
              daysOld: Math.floor(
                (Date.now() - stats.mtime.getTime()) / (24 * 60 * 60 * 1000)
              ),
            });
          }
        } catch (fileError) {
          this.warn("Failed to process log file during cleanup", {
            file,
            error: fileError.message,
          });
        }
      });

      if (deletedCount > 0) {
        this.info("Log cleanup completed", {
          deletedFiles: deletedCount,
          totalFilesBefore: totalFiles,
          totalSizeFreed: `${(totalSize / 1024 / 1024).toFixed(2)}MB`,
          cleanupDate: new Date().toISOString(),
        });
      } else {
        this.debug("Log cleanup completed - no files to delete", {
          totalFiles,
          cutoffDate: threeDaysAgo.toISOString(),
        });
      }

      // Log current disk usage
      this.logCurrentDiskUsage();
    } catch (error) {
      this.error("Log cleanup failed", {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  // Schedule automatic log cleanup (runs daily at 2 AM)
  scheduleLogCleanup() {
    // Schedule daily cleanup at 2:00 AM
    cron.schedule("0 2 * * *", () => {
      this.info("Starting scheduled log cleanup");
      this.cleanupOldLogs();
    });

    // Run cleanup immediately on startup (after 10 seconds to ensure server is ready)
    setTimeout(() => {
      this.info("Running initial log cleanup on startup");
      this.cleanupOldLogs();
    }, 10000); // Wait 10 seconds after server start

    // Also schedule cleanup every 6 hours as backup
    cron.schedule("0 */6 * * *", () => {
      this.debug("Running backup log cleanup");
      this.cleanupOldLogs();
    });
  }

  // Log current disk usage of logs
  logCurrentDiskUsage() {
    try {
      const logFiles = fs.readdirSync(this.logDir);
      let totalSize = 0;
      let fileCount = 0;

      logFiles.forEach((file) => {
        const filePath = path.join(this.logDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isFile() && file.endsWith(".log")) {
            totalSize += stats.size;
            fileCount++;
          }
        } catch (fileError) {
          // Skip files that can't be accessed
        }
      });

      this.info("Current log disk usage", {
        totalFiles: fileCount,
        totalSize: `${(totalSize / 1024 / 1024).toFixed(2)}MB`,
        averageFileSize:
          fileCount > 0
            ? `${(totalSize / fileCount / 1024).toFixed(2)}KB`
            : "0KB",
      });

      // Alert if logs are using too much space
      const sizeMB = totalSize / 1024 / 1024;
      if (sizeMB > 500) {
        this.warn("Log directory using significant disk space", {
          totalSize: `${sizeMB.toFixed(2)}MB`,
          recommendation: "Consider reducing log retention period",
        });
      }
    } catch (error) {
      this.debug("Failed to calculate log disk usage", {
        error: error.message,
      });
    }
  }
}

module.exports = new Logger();
