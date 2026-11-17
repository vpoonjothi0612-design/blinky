import { Router } from "express";

import {
  create,
  getAll,
  getById,
  update,
  remove,
  analyzeVideo,
  analyzeImage,
  analyzeSampleVideo,
} from "./vehicle.controller.js";

import { authenticate, authorize } from "../auth/auth.middleware.js";
import { uploadSingleImage, uploadSingleVideo } from "../../middleware/upload.middleware.js";

const router = Router();

// AI Vehicle Video Analysis Endpoint (Admin & Security)
router.post("/video", authenticate, authorize("ADMIN", "SECURITY"), uploadSingleVideo, analyzeVideo);

// AI Vehicle Sample Video Analysis Endpoint (Admin & Security)
router.post("/sample-video", authenticate, authorize("ADMIN", "SECURITY"), analyzeSampleVideo);

// AI Vehicle Image Analysis Endpoint (Admin & Security)
router.post("/image", authenticate, authorize("ADMIN", "SECURITY"), uploadSingleImage, analyzeImage);

// Vehicle Fleet & Blacklist Management (Admin & Security)
router.post("/", authenticate, authorize("ADMIN", "SECURITY"), create);
router.get("/", authenticate, authorize("ADMIN", "SECURITY"), getAll);
router.get("/:id", authenticate, authorize("ADMIN", "SECURITY"), getById);
router.put("/:id", authenticate, authorize("ADMIN", "SECURITY"), update);
router.delete("/:id", authenticate, authorize("ADMIN"), remove); // Only ADMIN can delete registered fleet records

export default router;
