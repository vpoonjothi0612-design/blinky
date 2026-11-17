import app from "./app.js";
import { connectDatabase } from "./config/database.js";
import "./modules/auth/auth.model.js";
import "./modules/shifts/shift.model.js";
import "./modules/employee/employee.model.js";
import "./modules/holiday/holiday.model.js";
import "./modules/leave/leave.model.js";
import "./modules/face-enrollment/face-enrollment.model.js";
import "./modules/camera/camera.model.js";
import "./modules/vehicle/vehicle.model.js";
import "./modules/attendance/attendance.model.js";

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDatabase();

    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    // Configure server timeout to support long CPU video processing requests
    server.setTimeout(1800000);
    server.headersTimeout = 1800000;
    server.requestTimeout = 1800000;

    // Start background camera event stream listener (CP PLUS AlarmMaster)
    const { startCameraEventListener } = await import("./services/cameraEventListener.service.js");
    startCameraEventListener().catch((err) => {
      console.warn("[CameraListener] Background start notice:", err.message);
    });

  } catch (error) {

    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
