# Quick Start

## Prereqs
- Node.js 18+
- MongoDB running locally or remote URI
- (Optional) SMTP + FCM keys if you want email/push

## 1) Install
```bash
npm install
```

## 2) Configure env
Copy values into `.env` (see README for full list):
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/cam-block-system
JWT_SECRET=change-me
```

## 3) Start server
```bash
npm run dev   # nodemon
```
Server listens at `http://localhost:5000`.

## 4) Seed a facility (optional public route)
```bash
curl -X POST http://localhost:5000/api/facilities/create-facility \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Main Building",
    "notificationEmails": ["CamBlock@example.com"],
    "timezone": "UTC"
  }'
```
Save the `facilityId` from the response.

## 5) Generate QR codes
```bash
npm run generate-qr -- all            # every facility
# or for one
npm run generate-qr -- <facilityId>
```
Tokens and PNGs are printed to the console and `uploads/qr-codes/`.

## 6) Get an admin token
```bash
curl -X POST http://localhost:5000/api/auth/admin/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Passw0rd!"}'
# login (use the same creds if already created)
curl -X POST http://localhost:5000/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Passw0rd!"}'
```
Copy `data.token` for the next steps.

## 7) Admin examples
```bash
# list admins
curl "http://localhost:5000/api/admin/admins?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# list facilities
curl "http://localhost:5000/api/admin/facilities?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# assign visitor info
curl -X PUT http://localhost:5000/api/admin/devices/test-device-123/visitor \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
```

## 8) Enrollment flow (public)
```bash
ENTRY_TOKEN="..."   # from QR
EXIT_TOKEN="..."    # from QR
DEVICE_ID="test-device-123"

# Entry (locks camera, reuses same enrollment record on re-entry)
curl -X POST http://localhost:5000/api/enrollments/scan-entry \
  -H "Content-Type: application/json" \
  -d '{
    "token":"'"'"$ENTRY_TOKEN'"'" ,
    "deviceId":"'"'"$DEVICE_ID'"'" ,
    "deviceInfo": {"platform":"android","model":"Pixel"}
  }'

# Exit (unlocks camera)
curl -X POST http://localhost:5000/api/enrollments/scan-exit \
  -H "Content-Type: application/json" \
  -d '{"token":"'"'"$EXIT_TOKEN'"'" ,"deviceId":"'"'"$DEVICE_ID'"'" }'
```

## 9) Restore from push (public)
When a device taps the restore push, call:
```bash
curl -X POST http://localhost:5000/api/enrollments/restore-from-push \
  -H "Content-Type: application/json" \
  -d '{"token":"RESTORE_TOKEN","deviceId":"'"'"$DEVICE_ID'"'" }'
```

## 10) Postman
Import `CamBlock_App_API.postman_collection.json` and set `base_url`, `admin_token`, and tokens in the collection variables.
