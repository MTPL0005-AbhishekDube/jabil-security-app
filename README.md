# CamBlock App Backend

Node.js + Express backend for QR-based visitor device control. It locks a visitor's camera on entry, unlocks on exit, rotates daily QR codes, and gives admins simple facility/device controls.

## Features
- Entry/Exit scans with MDM lock/unlock.
- Rotating random 6-digit `entryCode` and `exitCode` per facility (new pair every 15s, each valid for 20s).
- Single enrollment record per device (re-enroll updates the same doc).
- Admin JWT auth plus admin listing/detail endpoints.
- Facility CRUD with daily QR generation + email delivery.
- Device tools: active list, visitor assignment, force-exit, view active enrollment.
- Health check and configurable CORS/helmet logging.

## Prerequisites
- Node.js 18+
- MongoDB 6+
- SMTP creds for QR email (optional but recommended)
- FCM server key for push restore (optional)

## Setup
1) Install deps
```bash
npm install
```

2) Configure environment (`.env`)
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/CamBlock-app-system
JWT_SECRET=change-me
ADMIN_TOKEN_EXPIRE=15d
RESTORE_TOKEN_EXPIRE=2h
ALLOWED_ORIGINS=http://localhost:3000
ACCESS_CODE_ROTATION_SECONDS=15
ACCESS_CODE_TTL_SECONDS=20
RENDER_EXTERNAL_URL=
```

3) Run the server
```bash
npm run dev   # or npm start
```
Server listens on `http://localhost:${PORT}`.

4) Generate QR codes (manual run)
```bash
# All facilities
npm run generate-qr -- all
# Specific facility (_id or facilityId)
npm run generate-qr -- YOUR_FACILITY_ID
```
Generated PNGs land in `uploads/qr-codes/` and emails are sent when recipients are configured.

## API Overview
Base URL: `http://localhost:5000/api`

### Public
- `GET /health`
- `POST /facilities/create-facility`
- `POST /enrollments/scan-entry`
- `POST /enrollments/scan-exit`
- `POST /enrollments/scan-exit-code`
- `POST /enrollments/restore-from-push`

### Admin Auth
- `POST /auth/admin/register`
- `POST /auth/admin/login`

### Admin Users (JWT)
- `GET /admin/admins` — paginated, optional `q` search
- `GET /admin/admins/:id` — by Mongo `_id` (fallback to username)

### Admin Facilities (JWT)
- `GET /admin/facilities?page=1&limit=10&status=active&q=search`
- `POST /admin/facilities`
- `GET /admin/facilities/:id` (accepts `facilityId` or `_id`)
- `PUT /admin/facilities/:id`
- `DELETE /admin/facilities/:id` (sets status inactive)

### Admin Devices (JWT)
- `GET /admin/devices/active?page=1&limit=10&q=`
- `PUT /admin/devices/:deviceId/visitor`
- `GET /admin/devices/:deviceId/active-enrollment` (legacy `/admin/active-device/:deviceId` kept)
- `POST /admin/devices/:deviceId/force-exit`

### Enrollment Behavior
- A device keeps **one enrollment document**. Re-enrolling updates the same record (facility, QR refs, timestamps) instead of inserting a new one.
- Double entry in the same facility is idempotent (locks camera again); entry in a different facility while active returns 409 until the device exits.
- `scan-exit-code` validates `facilityId + exitCode + deviceId` and then executes the same unlock flow/response as `scan-exit`.
- Codes rotate every 15 seconds and expire after 20 seconds (5-second overlap to reduce edge timing failures).

## Postman
Import `CamBlock_App_API.postman_collection.json` (kept up to date with all routes above). Set `base_url` and `admin_token` in the collection variables.

## Scripts
- `npm run generate-qr -- <id|all>` — create entry/exit QRs
- `npm run generate-printable` — create printable sheets for all facilities

## Deployment Notes
- CORS origins derive from `ALLOWED_ORIGINS` (comma-separated). Helmet and morgan are enabled by default.
