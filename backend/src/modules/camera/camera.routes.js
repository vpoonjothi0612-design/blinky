
import { Router } from "express";

import {
  create,
  getAll,
  getById,
  update,
  remove,
  getStreamStatus,
  startStream,
  stopStream,
  testStreamConnection,
  getStreamEvents,
  getSnapshot,
  getLiveCameraStream,
  getLiveCameraFrame,
} from "./camera.controller.js";

import { authenticate, authorize } from "../auth/auth.middleware.js";

const router = Router();

// CP PLUS / AlarmMaster - Stream Diagnostics
router.get(
  "/stream/status",
  authenticate,
  authorize("ADMIN", "SECURITY"),
  getStreamStatus
);

router.post(
  "/stream/start",
  authenticate,
  authorize("ADMIN", "SECURITY"),
  startStream
);

router.post(
  "/stream/stop",
  authenticate,
  authorize("ADMIN", "SECURITY"),
  stopStream
);

router.post(
  "/stream/test",
  authenticate,
  authorize("ADMIN", "SECURITY"),
  testStreamConnection
);

router.get(
  "/stream/events",
  authenticate,
  authorize("ADMIN", "SECURITY"),
  getStreamEvents
);

router.get(
  "/snapshot",
  authenticate,
  authorize("ADMIN", "SECURITY"),
  getSnapshot
);

// Live Camera Monitoring
router.get("/live-stream", getLiveCameraStream);
router.get("/live-stream/:cameraId", getLiveCameraStream);
router.get("/live-frame", getLiveCameraFrame);
router.get("/live-frame/:cameraId", getLiveCameraFrame);

// Camera Monitoring - Read
router.get("/", authenticate, authorize("ADMIN", "SECURITY"), getAll);
router.get("/:id", authenticate, authorize("ADMIN", "SECURITY"), getById);

// Camera Hardware Configuration - ADMIN only
router.post("/", authenticate, authorize("ADMIN"), create);
router.put("/:id", authenticate, authorize("ADMIN"), update);
router.delete("/:id", authenticate, authorize("ADMIN"), remove);

export default router;
