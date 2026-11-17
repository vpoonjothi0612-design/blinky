import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import employeeRoutes from "../modules/employee/employee.routes.js";
import faceEnrollmentRoutes from "../modules/face-enrollment/face-enrollment.routes.js";
import faceTrackRoutes from "../modules/face-enrollment/face-tracks.routes.js";
import cameraRoutes from "../modules/camera/camera.routes.js";
import vehicleRoutes from "../modules/vehicle/vehicle.routes.js";
import attendanceRoutes from "../modules/attendance/attendance.routes.js";
import reportRoutes from "../modules/reports/report.routes.js";
import shiftRoutes from "../modules/shifts/shift.routes.js";
import eventRoutes from "../modules/event/event.routes.js";
import aiRoutes from "./ai.routes.js";
import mediaRoutes from "../modules/media/media.routes.js";
import crossingRoutes from "../modules/crossing/crossing.routes.js";

const router = Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Attendance & Vehicle Detection API is running",
    timestamp: new Date().toISOString(),
  });
});

router.use("/auth", authRoutes);
router.use("/employees", employeeRoutes);
router.use("/face-enrollments", faceEnrollmentRoutes);
router.use("/face", faceTrackRoutes);
router.use("/cameras", cameraRoutes);
router.use("/vehicles", vehicleRoutes);
router.use("/vehicle", vehicleRoutes); // Route alias for /api/vehicle/video
router.use("/attendance", attendanceRoutes);
router.use("/events", eventRoutes);
router.use("/media", mediaRoutes);
router.use("/crossings", crossingRoutes);
router.use("/reports", reportRoutes);
router.use("/shifts", shiftRoutes);
router.use("/ai", aiRoutes);

export default router;
