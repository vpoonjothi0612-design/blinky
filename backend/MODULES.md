# 🧠 Backend Modules Documentation
### Face Detection — Attendance & Vehicle Detection API

> **Stack:** Node.js · Express 5 · Sequelize ORM · PostgreSQL · JWT · Zod · Multer  
> **Base URL:** `http://localhost:3000/api`

---

## 📁 Project Structure

```
backend/
├── .env
├── package.json
├── MODULES.md
├── migrations/          (empty — using sequelize.sync())
├── seeders/             (empty)
└── src/
    ├── app.js           # Express app setup
    ├── server.js        # Entry point — DB connect + server start
    ├── config/
    │   ├── database.js  # Sequelize instance
    │   ├── db.js        # Alternate DB config
    │   └── env.js       # Env loader
    ├── middleware/
    │   ├── auth.middleware.js
    │   ├── error.middleware.js
    │   └── validation.middleware.js
    ├── models/
    │   └── index.js     # Model aggregator
    ├── routes/
    │   └── index.js     # Central router
    └── modules/
        ├── auth/
        ├── employee/
        ├── face-enrollment/
        ├── camera/
        ├── vehicle/
        ├── attendance/
        ├── shifts/
        ├── work-hours/
        ├── reports/
        └── ai-integration/
```

---

## ⚙️ Core Configuration

### `src/app.js`
Sets up the Express application with the following global middleware:

| Middleware | Purpose |
|---|---|
| `helmet` | Sets secure HTTP headers |
| `cors` | Enables Cross-Origin Resource Sharing |
| `express.json()` | Parses JSON request bodies |
| `express.urlencoded()` | Parses URL-encoded bodies |
| `morgan` (dev) | HTTP request logger (disabled in test env) |

All API routes are mounted under `/api`.

---

### `src/server.js`
Application entry point. Performs:
1. Imports all Sequelize models to register associations
2. Connects to PostgreSQL via `connectDatabase()`
3. Syncs all models via `sequelize.sync()`
4. Starts HTTP server on `PORT` (default: `3000`)

---

### Environment Variables (`.env`)

| Variable | Description |
|---|---|
| `PORT` | Server port |
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port |
| `DB_NAME` | Database name |
| `DB_USER` | DB username |
| `DB_PASSWORD` | DB password |
| `JWT_SECRET` | JWT signing secret |
| `JWT_EXPIRES_IN` | JWT token expiry (default: `1d`) |

---

## 🔐 Module 1 — Auth

**Path:** `src/modules/auth/`  
**Base Route:** `/api/auth`

### Files

| File | Purpose |
|---|---|
| `auth.model.js` | Sequelize `User` model |
| `auth.repository.js` | DB queries (`findByEmail`, `createUser`, `findById`) |
| `auth.service.js` | Business logic — register, login, token generation |
| `auth.controller.js` | HTTP handlers |
| `auth.middleware.js` | JWT `authenticate` guard |
| `auth.routes.js` | Route definitions |
| `auth.zod.js` | Zod validation schemas |

### API Endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | ❌ Public | Register a new admin/user |
| `POST` | `/api/auth/login` | ❌ Public | Login and receive JWT token |
| `GET` | `/api/auth/protected-test` | ✅ JWT | Test protected route |

### Service Logic
- **register** — Checks for duplicate email → hashes password (bcrypt, 12 rounds) → creates user → returns JWT
- **login** — Validates email/password → checks `isActive` → compares hash → returns JWT
- **JWT payload** — `{ id, email, role }`, expiry from `JWT_EXPIRES_IN`

---

## 👤 Module 2 — Employee

**Path:** `src/modules/employee/`  
**Base Route:** `/api/employees`  
**Auth:** All routes require JWT

### Files

| File | Purpose |
|---|---|
| `employee.model.js` | Sequelize `Employee` model |
| `employee.repository.js` | DB CRUD queries |
| `employee.service.js` | Business logic |
| `employee.controller.js` | HTTP handlers |
| `employee.routes.js` | Route definitions |
| `employee.zod.js` | Zod validation schemas |

### Model Fields

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key (auto-generated) |
| `employeeCode` | STRING(50) | Unique, required |
| `firstName` | STRING(100) | Required |
| `lastName` | STRING(100) | Optional |
| `email` | STRING(150) | Unique, optional |
| `phone` | STRING(20) | Optional |
| `department` | STRING(100) | Optional |
| `designation` | STRING(100) | Optional |
| `joiningDate` | DATEONLY | Optional |
| `status` | ENUM(`ACTIVE`, `INACTIVE`) | Default: `ACTIVE` |

### API Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/employees/` | Create new employee |
| `GET` | `/api/employees/` | Get all employees |
| `GET` | `/api/employees/:id` | Get employee by ID |
| `GET` | `/api/employees/code/:employeeCode` | Get employee by code |
| `PUT` | `/api/employees/:id` | Update employee |
| `DELETE` | `/api/employees/:id` | Remove employee |

---

## 🤖 Module 3 — Face Enrollment

**Path:** `src/modules/face-enrollment/`  
**Base Route:** `/api/face-enrollments`  
**Auth:** All routes require JWT

### Files

| File | Purpose |
|---|---|
| `face-enrollment.model.js` | Sequelize `FaceEnrollment` model |
| `face-enrollment.repository.js` | DB CRUD + employee lookup |
| `face-enrollment.service.js` | Business logic |
| `face-enrollment.controller.js` | HTTP handlers (supports file upload via multer) |
| `face-enrollment.routes.js` | Route definitions |
| `face-enrollment.zod.js` | Zod validation schemas |

### API Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/face-enrollments/` | Enroll a face (with embedding) |
| `GET` | `/api/face-enrollments/` | Get all enrollments |
| `GET` | `/api/face-enrollments/:id` | Get enrollment by ID |
| `GET` | `/api/face-enrollments/employee/:employeeId` | Get enrollments by employee |
| `PUT` | `/api/face-enrollments/:id` | Update enrollment |
| `DELETE` | `/api/face-enrollments/:id` | Remove enrollment |

> **Note:** Face embeddings are stored in the DB and synced to the AI service via `/api/ai-integration/sync`.

---

## 📷 Module 4 — Camera

**Path:** `src/modules/camera/`  
**Base Route:** `/api/cameras`  
**Auth:** All routes require JWT

### Files

| File | Purpose |
|---|---|
| `camera.model.js` | Sequelize `Camera` model |
| `camera.repository.js` | DB CRUD queries |
| `camera.service.js` | Business logic |
| `camera.controller.js` | HTTP handlers |
| `camera.routes.js` | Route definitions |
| `camera.zod.js` | Zod validation schemas |

### API Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/cameras/` | Register a new camera |
| `GET` | `/api/cameras/` | Get all cameras |
| `GET` | `/api/cameras/:id` | Get camera by ID |
| `PUT` | `/api/cameras/:id` | Update camera |
| `DELETE` | `/api/cameras/:id` | Remove camera |

---

## 🚗 Module 5 — Vehicle

**Path:** `src/modules/vehicle/`  
**Base Route:** `/api/vehicles`  
**Auth:** All routes require JWT

### Files

| File | Purpose |
|---|---|
| `vehicle.model.js` | Sequelize `Vehicle` model |
| `vehicle.repository.js` | DB CRUD queries |
| `vehicle.service.js` | Business logic |
| `vehicle.controller.js` | HTTP handlers |
| `vehicle.routes.js` | Route definitions |
| `vehicle.zod.js` | Zod validation schemas |

### Model Fields

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `registrationNumber` | STRING(50) | Unique, required |
| `type` | STRING(50) | Optional |
| `make` | STRING(50) | Optional |
| `model` | STRING(50) | Optional |
| `color` | STRING(30) | Optional |
| `employeeId` | UUID (FK) | References `Employee.id` |
| `status` | ENUM(`ACTIVE`, `INACTIVE`) | Default: `ACTIVE` |

### API Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/vehicles/` | Register vehicle |
| `GET` | `/api/vehicles/` | Get all vehicles |
| `GET` | `/api/vehicles/:id` | Get vehicle by ID |
| `PUT` | `/api/vehicles/:id` | Update vehicle |
| `DELETE` | `/api/vehicles/:id` | Remove vehicle |

---

## 🕐 Module 6 — Attendance

**Path:** `src/modules/attendance/`  
**Base Route:** `/api/attendance`  
**Auth:** All routes require JWT

### Files

| File | Purpose |
|---|---|
| `attendance.model.js` | Sequelize `Attendance` model |
| `attendance.repository.js` | DB queries + dedup logic |
| `attendance.service.js` | Business logic |
| `attendance.controller.js` | HTTP handlers |
| `attendance.routes.js` | Route definitions |
| `attendance.zod.js` | Zod validation schemas |

### Model Fields

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `employeeId` | UUID (FK) | References `Employee.id` |
| `cameraId` | UUID (FK) | References `Camera.id` |
| `timestamp` | DATE | Defaults to `NOW` |
| `status` | ENUM(`PRESENT`, `LATE`) | Default: `PRESENT` |

### Associations
- `Employee` hasMany `Attendance`
- `Camera` hasMany `Attendance`

### API Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/attendance/` | Record attendance event |
| `GET` | `/api/attendance/` | Get all records |
| `GET` | `/api/attendance/employee/:employeeId` | Get attendance by employee |

---

## 📅 Module 7 — Shifts

**Path:** `src/modules/shifts/`  
**Base Route:** `/api/shifts`  
**Auth:** All routes require JWT

### Files

| File | Purpose |
|---|---|
| `shift.model.js` | Sequelize `Shift` model |
| `shift.service.js` | Business logic |
| `shift.controller.js` | HTTP handlers |
| `shift.routes.js` | Route definitions |
| `shift.validator.js` | Input validation |

### API Endpoints

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/shifts/` | Create a shift |
| `GET` | `/api/shifts/` | Get all shifts |
| `GET` | `/api/shifts/:id` | Get shift by ID |
| `PUT` | `/api/shifts/:id` | Update shift |
| `DELETE` | `/api/shifts/:id` | Delete shift |

---

## ⏱️ Module 8 — Work Hours

**Path:** `src/modules/work-hours/`  
**Base Route:** `/api/work-hours`  
**Auth:** All routes require JWT

### Files

| File | Purpose |
|---|---|
| `workhours.service.js` | Calculates work hours from attendance |
| `workhours.controller.js` | HTTP handlers |
| `workhours.routes.js` | Route definitions |
| `workhours.validator.js` | Input validation |

### API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/work-hours/daily/:employeeId` | Get work hours for a specific day |
| `GET` | `/api/work-hours/range/:employeeId` | Get work hours over a date range |

---

## 📊 Module 9 — Reports

**Path:** `src/modules/reports/`  
**Base Route:** `/api/reports`  
**Auth:** All routes require JWT

### Files

| File | Purpose |
|---|---|
| `report.service.js` | Aggregates data for reports |
| `report.controller.js` | HTTP handlers |
| `report.routes.js` | Route definitions |
| `report.validator.js` | Query param validation |

### API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/reports/attendance` | Attendance report with filters |
| `GET` | `/api/reports/summary` | Summary/analytics report |

---

## 🤖 Module 10 — AI Integration

**Path:** `src/modules/ai-integration/`  
**Base Route:** `/api/ai-integration`  
**Auth:** All routes require JWT

### Files

| File | Purpose |
|---|---|
| `ai-integration.service.js` | Bridges AI service ↔ backend |
| `ai-integration.controller.js` | HTTP handlers |
| `ai-integration.routes.js` | Route definitions |
| `ai-integration.zod.js` | Zod validation schemas |

### API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/ai-integration/sync` | AI service fetches face embeddings + registered vehicles |
| `POST` | `/api/ai-integration/detect` | AI service pushes detection events (`FACE` / `VEHICLE`) |

### Service Logic

#### `getSyncData()`
Returns all face embeddings and registered vehicle numbers for the AI model:
```json
{
  "faces": [{ "employeeId": "...", "embedding": [...] }],
  "vehicles": [{ "registrationNumber": "KA01AB1234", "employeeId": "..." }]
}
```

#### `processDetectionEvent(data)`
Handles detection events from the AI model:
- **`type: "FACE"`** → calls `createAttendance()` for the matched employee
- **`type: "VEHICLE"`** → logs event (attendance tracking not yet implemented)

---

## 🔗 Module Dependency Map

```
ai-integration
  ├── face-enrollment   (getSyncData → getAllFaceEnrollments)
  ├── vehicle           (getSyncData → getAllVehicles)
  ├── camera            (processDetectionEvent → getCameraById)
  └── attendance        (processDetectionEvent → createAttendance)

attendance
  ├── employee          (FK: employee_id)
  └── camera            (FK: camera_id)

vehicle
  └── employee          (FK: employee_id)

face-enrollment
  └── employee          (FK: employee_id)
```

---

## 📦 Dependencies

| Package | Version | Purpose |
|---|---|---|
| `express` | ^5.2.1 | Web framework |
| `sequelize` | ^6.37.8 | ORM for PostgreSQL |
| `pg` / `pg-hstore` | ^8.23.0 | PostgreSQL driver |
| `bcryptjs` | ^3.0.3 | Password hashing |
| `jsonwebtoken` | ^9.0.3 | JWT auth |
| `zod` | ^4.6.5 | Schema validation |
| `multer` | ^2.4.0 | File upload (face images) |
| `helmet` | ^8.3.0 | HTTP security headers |
| `cors` | ^2.8.6 | CORS support |
| `morgan` | ^1.12.1 | HTTP request logging |
| `dotenv` | ^18.0.3 | Environment variables |
| `nodemon` | ^3.1.14 | Dev auto-restart (devDep) |

---

## 🚀 NPM Scripts

```bash
npm run dev    # Start with nodemon (development — auto-restart)
npm start      # Start with node (production)
```

---

## 🏥 Health Check

```
GET /api/health
```

**Response:**
```json
{
  "success": true,
  "message": "Attendance & Vehicle Detection API is running",
  "timestamp": "2026-09-28T03:08:27.000Z"
}
```
