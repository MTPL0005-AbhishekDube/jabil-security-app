# System Architecture

## Overview
Express API backed by MongoDB. Key domains are Admins, Facilities, QR Codes, Devices, Enrollments (one active record per device, reused on re-entry), and short-lived Facility Access Codes. Daily QR rotation runs on a cron to refresh tokens and email facility contacts.

```
Mobile App ──▶ /api/enrollments (entry/exit/restore)
            │
            ├──▶ /api/enrollments/scan-exit-code (facility + 6-digit exit code)
            │
            └──▶ /api/facilities/create-facility (public setup)

Admin UI / Tools ──▶ /api/auth/admin/login
                  └─▶ /api/admin/* (admins, facilities, devices)

MDM Service ──▶ utils/mdmService (lock/unlock + push restore)

MongoDB ──▶ Admin, Facility, QRCode, Device, Enrollment collections
```

## Request Flows
### Entry (lock camera)
1. App posts `token + deviceId + deviceInfo` to `/api/enrollments/scan-entry`.
2. Token is validated against QRCode (must be type `entry`).
3. Device record is created/updated; camera lock requested via `mdmService`.
4. Enrollment document is **reused or created once** for the device; status set to `active` and QR references updated.
5. Device status set to `active`, QR scan recorded, success returned.

### Exit (unlock camera)
1. App posts `token + deviceId` to `/api/enrollments/scan-exit`.
2. QR is validated (type `exit`).
3. Active enrollment is completed (`status=completed`, `unenrolledAt` set).
4. Device status set to `inactive`; camera unlock requested.

### Exit via 6-digit code (unlock camera)
1. App posts `facilityId + exitCode + deviceId` to `/api/enrollments/scan-exit-code`.
2. Exit code is validated against a short-lived facility-linked code record.
3. Service resolves active exit QR for that facility and delegates to the same `scan-exit` unlock flow.
4. Response and side effects match `scan-exit`.

### Force Exit (admin)
1. Admin posts to `/api/admin/devices/:deviceId/force-exit` (or legacy `/api/enrollments/admin/force-exit`).
2. Active enrollment is marked `forced_exit`; device unlocked; optional restore push token sent.

## Data Model Highlights
- **Admin**: username/password (argon2); JWT used for admin routes.
- **Facility**: `facilityId`, notification emails, timezone, status.
- **Facility Access Code**: random 6-digit entry/exit codes per facility (rotated every 15s, valid 20s).
- **QRCode**: entry/exit tokens with validity window and scan counters.
- **Device**: device metadata, visitorId, push token, `currentFacility`.
- **Enrollment**: one-per-device record; stores entry/exit QR refs, status, timestamps.

## Project Layout
```
server.js
controllers/
  auth.controller.js
  admin.controller.js
  device.controller.js
  enrollment.controller.js
  facility.controller.js
middleware/
  auth.js
  errorHandler.js
models/
  Admin.model.js
  Device.model.js
  Enrollment.model.js
  Facility.model.js
  QRCode.model.js
routes/
  admin.routes.js
  auth.routes.js
  enrollment.routes.js
  facility.routes.js
services/
  dailyQRService.js
scripts/
  generateQR.js
  generate_printable_qrs.js
utils/
  jwt.js
  mdmService.js
  qrGenerator.js
  emailService.js
```

## Deployment Notes
- Static assets served from `/uploads`.
- Helmet, CORS (from `ALLOWED_ORIGINS`), and morgan logging enabled globally.
