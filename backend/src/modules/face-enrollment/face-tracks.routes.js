import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import { authenticate, authorize } from "../auth/auth.middleware.js";

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = path.resolve(__dirname, "../../../../ai-services/data/debug");
const ALLOWED_CAMERAS = new Set(["CAM-01", "CAM-02"]);

const readCameraTracks = (cameraId) => {
  const filePath = path.join(DEBUG_DIR, `face_tracks_${cameraId}.json`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { camera_id: cameraId, tracks: [] };
    throw error;
  }
};

router.get("/tracks", authenticate, authorize("ADMIN", "SECURITY"), (req, res, next) => {
  try {
    const requestedCamera = req.query.camera_id;
    if (requestedCamera && !ALLOWED_CAMERAS.has(requestedCamera)) {
      return res.status(400).json({ success: false, message: "camera_id must be CAM-01 or CAM-02" });
    }
    const cameras = requestedCamera ? [requestedCamera] : [...ALLOWED_CAMERAS];
    const snapshots = cameras.map(readCameraTracks);
    return res.status(200).json(requestedCamera
      ? { success: true, ...snapshots[0] }
      : { success: true, cameras: snapshots });
  } catch (error) {
    return next(error);
  }
});

export default router;
