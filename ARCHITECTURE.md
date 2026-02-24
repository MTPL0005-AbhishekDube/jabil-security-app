# System Architecture

## 📊 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Mobile Apps                              │
│                    (Android & iOS)                               │
│                                                                   │
│  ┌──────────────┐              ┌──────────────┐                │
│  │ QR Scanner   │              │ MDM Client   │                │
│  │              │              │              │                │
│  │ - Scan Entry │              │ - Enroll     │                │
│  │ - Scan Exit  │              │ - Lock       │                │
│  └──────────────┘              └──────────────┘                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ HTTPS / REST API
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                    Node.js Backend Server                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     API Routes                           │   │
│  │  /api/auth          /api/facilities      /api/qr        │   │
│  │  /api/enrollments   /api/devices         /api/admin     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Middleware Layer                      │   │
│  │  - Authentication (JWT)                                  │   │
│  │  - Authorization (RBAC)                                  │   │
│  │  - Rate Limiting                                         │   │
│  │  - Error Handling                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Business Logic                         │   │
│  │  - Enrollment Management                                 │   │
│  │  - QR Code Generation                                    │   │
│  │  - Device Management                                     │   │
│  │  - Facility Management                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   MDM Integration                        │   │
│  │  - Android (Work Profile / Device Admin)                │   │
│  │  - iOS (MDM Profile / Supervision)                       │   │
│  │  - Camera Lock/Unlock Policies                          │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Mongoose ODM
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                      MongoDB Database                            │
│                                                                   │
│  Collections:                                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Admins    │  │ Facilities  │  │  QR Codes   │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │   Devices   │  │ Enrollments │  │ Audit Logs  │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└───────────────────────────────────────────────────────────────────┘
```

## 🔄 Enrollment Flow

### Entry Flow (Camera Lock)

```
1. Visitor arrives at facility entrance
         │
         ▼
2. Opens mobile app and scans Entry QR Code
         │
         ▼
3. App sends token + device info to backend
   POST /api/enrollments/scan-entry
         │
         ▼
4. Backend validates QR token
         │
         ├─ Invalid → Return error
         │
         ▼ Valid
5. Backend enrolls device in MDM
         │
         ▼
6. MDM locks camera hardware
         │
         ▼
7. Create enrollment record in database
         │
         ▼
8. Return success response to app
         │
         ▼
9. App displays confirmation
   "Camera locked. Enjoy your visit!"
```

### Exit Flow (Camera Unlock)

```
1. Visitor prepares to leave
         │
         ▼
2. Scans Exit QR Code
         │
         ▼
3. App sends token + device ID to backend
   POST /api/enrollments/scan-exit
         │
         ▼
4. Backend validates QR token and enrollment
         │
         ├─ Not enrolled → Return error
         │
         ▼ Valid
5. MDM unlocks camera hardware
         │
         ▼
6. Unenroll device from MDM
         │
         ▼
7. Complete enrollment record
         │
         ▼
8. Return success response
         │
         ▼
9. App displays confirmation
   "Camera unlocked. Thank you for visiting!"
```

## 📁 Project Structure

```
security-app-backend/
│
├── server.js                    # Main application entry point
├── package.json                 # Dependencies and scripts
├── .env                         # Environment variables
├── .env.example                 # Environment template
├── README.md                    # Complete documentation
├── QUICKSTART.md               # Quick start guide
│
├── models/                      # Database schemas
│   ├── Admin.model.js          # Admin user schema
│   ├── Facility.model.js       # Facility schema
│   ├── QRCode.model.js         # QR code schema
│   ├── Device.model.js         # Device schema
│   ├── Enrollment.model.js     # Enrollment schema
│   └── AuditLog.model.js       # Audit log schema
│
├── controllers/                 # Business logic
│   ├── auth.controller.js      # Authentication logic
│   ├── facility.controller.js  # Facility management
│   ├── qr.controller.js        # QR code operations
│   ├── enrollment.controller.js # Enrollment logic (CORE)
│   ├── device.controller.js    # Device management
│   └── admin.controller.js     # Admin dashboard
│
├── routes/                      # API endpoints
│   ├── auth.routes.js
│   ├── facility.routes.js
│   ├── qr.routes.js
│   ├── enrollment.routes.js
│   ├── device.routes.js
│   └── admin.routes.js
│
├── middleware/                  # Express middleware
│   ├── auth.js                 # JWT authentication
│   ├── errorHandler.js         # Global error handler
│   └── rateLimiter.js          # Rate limiting
│
├── utils/                       # Utility functions
│   ├── jwt.js                  # JWT token utilities
│   ├── qrGenerator.js          # QR code generation
│   └── mdmService.js           # MDM integration
│
├── scripts/                    # Utility scripts│             
│   └── generateQR.js           # QR code generator CLI
│
└── uploads/                     # File uploads
    └── qr-codes/               # Generated QR images
```

## 🔐 Security Architecture

### Authentication Flow

```
1. Admin logs in with email/password
         │
         ▼
2. Server validates credentials
         │
         ▼
3. Generate JWT token (7 days expiry)
         │
         ▼
4. Return token to client
         │
         ▼
5. Client includes token in Authorization header
   "Authorization: Bearer <token>"
         │
         ▼
6. Server validates token on each request
         │
         ├─ Invalid/Expired → 401 Unauthorized
         │
         ▼ Valid
7. Proceed with request
```

### Authorization Levels

```
┌─────────────────────────────────────────────────┐
│              Super Admin                         │
│  - Full system access                           │
│  - Manage admins                                │
│  - All facility operations                      │
│  - View all logs                                │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│                 Admin                            │
│  - Manage facilities                            │
│  - Generate QR codes                            │
│  - View enrollments                             │
│  - Manage devices                               │
└─────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│               Operator                           │
│  - View facilities                              │
│  - View enrollments                             │
│  - View devices                                 │
│  - Read-only access                             │
└─────────────────────────────────────────────────┘
```

## 🗄️ Database Schema Relationships

```
┌─────────────┐
│   Admins    │
└──────┬──────┘
       │ creates
       │
       ▼
┌─────────────┐
│ Facilities  │◄─────┐
└──────┬──────┘      │
       │ has         │
       │             │
       ▼             │
┌─────────────┐      │ belongs to
│  QR Codes   │      │
└──────┬──────┘      │
       │ scanned by  │
       │             │
       ▼             │
┌─────────────┐      │
│   Devices   │──────┘
└──────┬──────┘
       │ enrolled in
       │
       ▼
┌─────────────┐
│ Enrollments │
└──────┬──────┘
       │ logs
       │
       ▼
┌─────────────┐
│ Audit Logs  │
└─────────────┘
```

## 🔄 Data Flow

### QR Code Generation

```
Admin Dashboard
       │
       ▼
1. Select Facility
       │
       ▼
2. Click "Generate QR Codes"
       │
       ▼
3. Backend creates QR data
   - Generate unique ID
   - Create JWT token
   - Generate deep link URL
       │
       ▼
4. Generate QR image (PNG)
       │
       ▼
5. Save to database
       │
       ▼
6. Save image to disk
       │
       ▼
7. Return URLs to admin
       │
       ▼
8. Admin prints/displays QR codes
```

### Device Enrollment

```
Mobile App
       │
       ▼
1. Scan QR Code
       │
       ▼
2. Parse token from URL
       │
       ▼
3. Send to backend with device info
       │
       ▼
Backend
       │
       ▼
4. Validate QR token
       │
       ▼
5. Check facility status
       │
       ▼
6. Find/Create device record
       │
       ▼
7. Call MDM service
       │
       ▼
MDM Service
       │
       ▼
8. Enroll device
       │
       ▼
9. Apply camera restriction
       │
       ▼
Backend
       │
       ▼
10. Create enrollment record
       │
       ▼
11. Update statistics
       │
       ▼
12. Log audit trail
       │
       ▼
13. Return success to app
```

## 🚀 Deployment Architecture

### Development Environment
```
Local Machine
├── Node.js Server (localhost:5000)
├── MongoDB (localhost:27017)
└── File System (local storage)
```

### Production Environment
```
┌───────────────────────────────────────────────┐
│              Load Balancer                     │
│              (Nginx/HAProxy)                   │
└────────────────┬──────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
┌───────▼───────┐  ┌──────▼──────┐
│  Node Server  │  │ Node Server │
│   Instance 1  │  │  Instance 2 │
└───────┬───────┘  └──────┬──────┘
        │                 │
        └────────┬────────┘
                 │
        ┌────────▼────────┐
        │                 │
┌───────▼───────┐  ┌──────▼──────┐
│   MongoDB     │  │  File Store │
│  Replica Set  │  │   (S3/NAS)  │
└───────────────┘  └─────────────┘
```

## 📊 Performance Considerations

### Optimization Strategies

1. **Database Indexing**
   - Index on deviceId for fast lookups
   - Index on facilityId for facility queries
   - Index on status for filtering
   - Index on timestamps for sorting

2. **Caching**
   - Cache facility data (Redis)
   - Cache QR token validation results
   - Cache admin authentication

3. **Rate Limiting**
   - 100 requests per 15 minutes per IP
   - Separate limits for public vs admin endpoints

4. **Connection Pooling**
   - MongoDB connection pool
   - Keep-alive connections

## 🔍 Monitoring & Logging

### What to Monitor

1. **System Health**
   - CPU usage
   - Memory usage
   - Disk space
   - Network I/O

2. **Application Metrics**
   - Request rate
   - Response time
   - Error rate
   - Active enrollments

3. **Business Metrics**
   - Total enrollments
   - Average visit duration
   - QR scan success rate
   - Device platform distribution

### Logging Strategy

```
Audit Logs:
- Who did what, when
- Login attempts
- QR generation
- Enrollment actions
- Policy changes

Error Logs:
- Application errors
- API failures
- Database errors
- MDM integration issues

Access Logs:
- All API requests
- Response times
- Status codes
```

## 🔒 Security Best Practices

1. **Authentication**
   - Strong password requirements
   - JWT with expiration
   - Refresh token rotation

2. **Authorization**
   - Role-based access control
   - Principle of least privilege
   - Action-level permissions

3. **Data Protection**
   - Encrypted connections (HTTPS)
   - Password hashing (bcrypt)
   - Sensitive data encryption at rest

4. **API Security**
   - Rate limiting
   - CORS configuration
   - Input validation
   - SQL injection prevention

5. **Compliance**
   - GDPR considerations
   - Data retention policies
   - Audit trail maintenance
   - User consent tracking

---

This architecture provides:
✅ Scalability
✅ Security
✅ Maintainability
✅ Performance
✅ Reliability
