# 🚀 Quick Start Guide

## Prerequisites
- Node.js v14+ installed
- MongoDB v4.4+ running
- SMTP credentials (for daily QR email)
- Postman (optional, for API testing)

## Step-by-Step Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
# Copy environment file
cp .env.example .env

# Edit .env and set:
# - MONGODB_URI (your MongoDB connection string)
# - JWT_SECRET (a strong random string)
```

### 3. Create Upload Directory
```bash
mkdir -p uploads/qr-codes
```

### 5. Start Server
```bash
# Development mode (with auto-reload)
npm run dev

# OR Production mode
npm start
```

Server will start at: `http://localhost:5000`

### 6. Test the API

#### Option A: Using Postman
1. Import `Camera_Lock_API.postman_collection.json`
2. Run the "Login" request first
3. Token will be auto-saved for other requests

#### Option B: Using cURL
```bash
# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Admin@123456"}'

# Save the token from response
TOKEN="your-jwt-token-here"

# Get facilities
curl http://localhost:5000/api/facilities \
  -H "Authorization: Bearer $TOKEN"
```

### 7. Create Your First Facility
```bash
curl -X POST http://localhost:5000/api/facilities \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Main Building",
    "location": {
      "address": "123 Main St",
      "city": "Indore",
      "state": "Madhya Pradesh",
      "country": "India"
    }
  }'
```

Save the `facility._id` from the response.

### 8. Generate QR Codes
```bash
# Using script
# All facilities:
node scripts/generateQR.js all
# Single facility (Mongo _id or facilityId string):
node scripts/generateQR.js YOUR_FACILITY_ID
```

QR code images (including printable variants) will be saved in: `uploads/qr-codes/`

### 9. Test Enrollment Flow

#### Step 1: Get QR Token
From the QR generation response, copy the `entryQR.token`

#### Step 2: Scan Entry QR (Lock Camera)
```bash
curl -X POST http://localhost:5000/api/enrollments/scan-entry \
  -H "Content-Type: application/json" \
  -d '{
    "token": "ENTRY_QR_TOKEN",
    "deviceId": "test-device-123",
    "deviceInfo": {
      "manufacturer": "Samsung",
      "model": "Galaxy S21",
      "osVersion": "Android 13",
      "platform": "android",
      "appVersion": "1.0.0"
    },
    "visitorInfo": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }'
```

#### Step 3: Check Enrollment Status
```bash
curl http://localhost:5000/api/enrollments/status/test-device-123
```

#### Step 4: Scan Exit QR (Unlock Camera)
```bash
curl -X POST http://localhost:5000/api/enrollments/scan-exit \
  -H "Content-Type: application/json" \
  -d '{
    "token": "EXIT_QR_TOKEN",
    "deviceId": "test-device-123"
  }'
```

### 10. View Dashboard
```bash
curl http://localhost:5000/api/admin/dashboard \
  -H "Authorization: Bearer $TOKEN"
```

## 📱 Mobile App Integration

### For Android:
1. Integrate QR scanner (ZXing library)
2. Parse scanned URL to extract token
3. Call `/api/enrollments/scan-entry` with device info
4. Request Device Admin permissions when prompted
5. Apply camera restriction policy

### For iOS:
1. Integrate QR scanner (AVFoundation)
2. Parse scanned URL to extract token
3. Call `/api/enrollments/scan-entry` with device info
4. Download MDM profile from response
5. Guide user to install profile in Settings → General → VPN & Device Management

## 🔍 Troubleshooting

### MongoDB Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:27017
```
**Solution**: Make sure MongoDB is running:
```bash
# Check if MongoDB is running
sudo systemctl status mongod

# Start MongoDB
sudo systemctl start mongod
```

### Port Already in Use
```
Error: listen EADDRINUSE: address already in use :::5000
```
**Solution**: Change port in `.env` or kill the process using port 5000:
```bash
# Find process
lsof -i :5000

# Kill process
kill -9 <PID>
```

### QR Code Not Generating
**Solution**: Check upload directory permissions:
```bash
chmod 755 uploads/qr-codes
```

## 📚 Next Steps

1. ✅ Read the full API documentation in `README.md`
2. ✅ Explore all endpoints using Postman collection
3. ✅ Customize facility settings
4. ✅ Integrate with your mobile app
5. ✅ Set up production environment
6. ✅ Change default admin password
7. ✅ Configure MDM provider integration

## 🆘 Need Help?

- Check `README.md` for detailed documentation
- Review code comments in controllers
- Check audit logs for debugging
- Contact support team

## 🎉 Success!

You now have a fully functional Security App backend system running!

The system flow:
```
Visitor arrives → Scans Entry QR → Camera locked → Visit complete → Scans Exit QR → Camera unlocked
```

Happy coding! 🚀
