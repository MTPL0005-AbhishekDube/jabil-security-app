const admin = require("firebase-admin");
const logger = require("./logger");

class FirebaseService {
  constructor() {
    this.isInitialized = false;
    this.initializeFirebase();
  }

  initializeFirebase() {
    try {
      // Check if already initialized
      if (admin.apps.length > 0) {
        this.isInitialized = true;
        logger.info("Firebase Admin SDK already initialized");
        return;
      }

      // Check for required environment variables
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;

      if (!projectId || !clientEmail || !privateKey) {
        logger.warn(
          "Firebase Admin SDK not configured - missing environment variables",
          {
            hasProjectId: !!projectId,
            hasClientEmail: !!clientEmail,
            hasPrivateKey: !!privateKey,
          }
        );
        return;
      }

      // Initialize Firebase Admin SDK
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n"),
        }),
        projectId: projectId,
      });

      this.isInitialized = true;
      logger.info("Firebase Admin SDK initialized successfully", {
        projectId,
        clientEmail,
      });
    } catch (error) {
      logger.error("Failed to initialize Firebase Admin SDK", {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  // Send enhanced push notification with platform-specific optimizations
  async sendEnhancedPush(pushToken, payload) {
    const operationId = `firebase_push_${Date.now()}`;

    try {
      if (!this.isInitialized) {
        return { success: false, error: "Firebase not initialized" };
      }

      if (!pushToken) {
        logger.warn(`[Firebase] Push notification failed - missing pushToken`, {
          operationId,
          hasPushToken: false,
        });
        return { success: false, error: "missing pushToken" };
      }

      const message = {
        token: pushToken,
        notification: {
          title: payload.title || "CamBlock Alert",
          body: payload.message || "Action required",
        },
        data: {
          type: payload.type || "RESTORE",
          token: payload.token || "",
          deviceId: payload.deviceId || "",
          facilityId: payload.facilityId?.toString() || "",
          timestamp: Date.now().toString(),
        },
        android: {
          priority: "high",
          ttl: 2419200000, // 28 days in milliseconds
          notification: {
            sound: "default",
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
            icon: "ic_notification",
            color: "#2196F3",
          },
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
              category: "RESTORE_CATEGORY",
              badge: 1,
            },
          },
        },
      };

      const response = await admin.messaging().send(message);

      logger.info(`[Firebase] Enhanced push notification sent successfully`, {
        operationId,
        messageId: response,
        pushToken: pushToken.substring(0, 20) + "...",
      });

      return {
        success: true,
        sentAt: new Date().toISOString(),
        messageId: response,
        service: "firebase-admin-sdk",
      };
    } catch (error) {
      logger.error(`[Firebase] Enhanced push notification failed`, {
        operationId,
        pushToken: pushToken ? pushToken.substring(0, 20) + "..." : "none",
        error: error.message,
        errorCode: error.code,
        stack: error.stack,
      });

      return {
        success: false,
        error: error.message,
        errorCode: error.code,
        service: "firebase-admin-sdk",
      };
    }
  }

  // Send multicast message to multiple devices
  async sendMulticastNotification(pushTokens, payload) {
    const operationId = `firebase_multicast_${Date.now()}`;

    try {
      if (!this.isInitialized) {
        return { success: false, error: "Firebase not initialized" };
      }

      if (!pushTokens || pushTokens.length === 0) {
        logger.warn(
          `[Firebase] Multicast notification failed - no push tokens`,
          {
            operationId,
            tokenCount: 0,
          }
        );
        return { success: false, error: "no push tokens provided" };
      }

      const message = {
        tokens: pushTokens,
        notification: {
          title: payload.title || "CamBlock Alert",
          body: payload.message || "Action required",
        },
        data: {
          type: payload.type || "RESTORE",
          timestamp: Date.now().toString(),
        },
        android: {
          priority: "high",
          ttl: 2419200000,
        },
        apns: {
          payload: {
            aps: {
              sound: "default",
              category: "RESTORE_CATEGORY",
            },
          },
        },
      };

      const response = await admin.messaging().sendMulticast(message);

      logger.info(`[Firebase] Multicast notification completed`, {
        operationId,
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: response.failureCount + response.successCount,
      });

      return {
        success: true,
        sentAt: new Date().toISOString(),
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses,
        service: "firebase-admin-sdk",
      };
    } catch (error) {
      logger.error(`[Firebase] Multicast notification failed`, {
        operationId,
        tokenCount: pushTokens?.length || 0,
        error: error.message,
        errorCode: error.code,
        stack: error.stack,
      });

      return {
        success: false,
        error: error.message,
        errorCode: error.code,
        service: "firebase-admin-sdk",
      };
    }
  }

  // Subscribe devices to a topic
  async subscribeToTopic(pushTokens, topic) {
    const operationId = `firebase_subscribe_${Date.now()}`;

    try {
      if (!this.isInitialized) {
        return { success: false, error: "Firebase not initialized" };
      }

      const response = await admin
        .messaging()
        .subscribeToTopic(pushTokens, topic);

      logger.info(`[Firebase] Topic subscription completed`, {
        operationId,
        topic,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
        topic,
      };
    } catch (error) {
      logger.error(`[Firebase] Topic subscription failed`, {
        operationId,
        topic,
        error: error.message,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Get Firebase initialization status
  getStatus() {
    return {
      initialized: this.isInitialized,
      appsCount: admin.apps.length,
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };
  }
}

module.exports = new FirebaseService();
