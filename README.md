# Security App Backend

A streamlined Node.js backend for the Security App. This backend handles device enrollment (entry/lock) and unenrollment (exit/unlock) via QR codes.

## 🚀 Features

- **Entry Scan**: Validates entry QR and locks camera.
- **Exit Scan**: Validates exit QR and unlocks camera.
- **Setup**: Script to generate Entry/Exit QRs for testing.
- **Daily QR Rotation**: Generates per-facility Entry/Exit QR codes daily, emails them to facility contacts, and expires prior codes/devices automatically.

## 📋 Prerequisites

- Node.js (v14 or higher)
- MongoDB (running locally or accessible via URI)

## 🛠️ Installation & Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   Ensure `.env` exists and has the correct `MONGODB_URI`.
   ```bash
   # Example .env
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/security-app-system
   JWT_SECRET=your-secret
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=example@example.com
   SMTP_PASS=example-password
   EMAIL_FROM=Security App <no-reply@example.com>
   DAILY_QR_CRON=0 12 * * *
   DAILY_QR_TZ=UTC
   ```

3. **Run Setup (Generates QRs)**
   This script creates a test Facility and generates the Entry and Exit QR tokens you need for the app.
   ```bash
   npm run setup
   ```
   **Copy the tokens output by this script.** You will use them in your API requests.

4. **(Optional) Create a facility without admin**
   ```bash
   curl -X POST http://localhost:5000/api/facilities/create-facility \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Main Building",
       "description": "Primary site",
       "notificationEmails": ["you@example.com"],
       "timezone": "UTC"
     }'
   ```

5. **Start the server**
   ```bash
   npm start
   ```
   Server runs on `http://localhost:5000`.

## 📚 API Endpoints

### Base URL
`http://localhost:5000/api`

### 1. Entry Scan (Lock Camera)
**Endpoint**: `POST /enrollments/scan-entry`

**Request Body**:
```json
{
  "token": "QR_CODE_CONTENT_FROM_SETUP",
  "deviceId": "UNIQUE_DEVICE_ID",
  "deviceInfo": {
    "manufacturer": "Google",
    "model": "Pixel 6",
    "osVersion": "Android 13",
    "platform": "android",
    "appVersion": "1.0.0"
  }
}
```

**Response**:
```json
{
  "status": "success",
  "message": "Entry allowed",
  "data": {
    "enrollmentId": "...",
    "facilityName": "Secure Facility A",
    "action": "LOCK_CAMERA"
  }
}
```

### 2. Exit Scan (Unlock Camera)
**Endpoint**: `POST /enrollments/scan-exit`

**Request Body**:
```json
{
  "token": "QR_CODE_CONTENT_FROM_SETUP",
  "deviceId": "UNIQUE_DEVICE_ID"
}
```

**Response**:
```json
{
  "status": "success",
  "message": "Exit allowed",
  "data": {
    "action": "UNLOCK_CAMERA"
  }
}
```
