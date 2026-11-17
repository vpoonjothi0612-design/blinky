
import { Router } from "express";

import {
  create,
  createManual,
  getAll,
  getByEmployeeId,
  getDailySummary,
  getLiveStream,
  getLiveStatsHandler,
  getLatestRecognitionHandler,
  getStoredPhotosHandler,
} from "./attendance.controller.js";

import { authenticate, authorize } from "../auth/auth.middleware.js";

const router = Router();

// Live Monitoring, Telemetry & Stored Captured Photos
router.get("/live-stream", authenticate, getLiveStream);
router.get("/live-stats", authenticate, getLiveStatsHandler);
router.get("/latest-recognition", authenticate, getLatestRecognitionHandler);
router.get("/stored-photos", authenticate, getStoredPhotosHandler);

// Manual Attendance Entry - ADMIN only
router.post("/manual", authenticate, authorize("ADMIN"), createManual);

// Clock-in / Camera Punch
router.post(
  "/",
  authenticate,
  authorize("ADMIN", "STAFF", "SECURITY"),
  create
);

// Attendance Queries
router.get(
  "/",
  authenticate,
  authorize("ADMIN", "STAFF", "SECURITY"),
  getAll
);

router.get(
  "/daily-summary/:employeeId",
  authenticate,
  authorize("ADMIN", "STAFF", "SECURITY"),
  getDailySummary
);

router.get(
  "/employee/:employeeId",
  authenticate,
  authorize("ADMIN", "STAFF", "SECURITY"),
  getByEmployeeId
);

export default router;
