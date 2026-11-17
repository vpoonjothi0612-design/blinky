import {
  createVehicle,
  getAllVehicles,
  getVehicleById,
  updateVehicle,
  deleteVehicle,
} from "./vehicle.service.js";
import { createVehicleSchema, updateVehicleSchema } from "./vehicle.zod.js";

export const create = async (req, res, next) => {
  try {
    const validation = createVehicleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const vehicle = await createVehicle(validation.data);

    return res.status(201).json({
      success: true,
      message: "Vehicle created successfully",
      data: vehicle,
    });
  } catch (error) {
    next(error);
  }
};

export const getAll = async (req, res, next) => {
  try {
    const vehicles = await getAllVehicles();

    return res.status(200).json({
      success: true,
      message: "Vehicles retrieved successfully",
      data: vehicles,
    });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req, res, next) => {
  try {
    const vehicle = await getVehicleById(req.params.id);

    return res.status(200).json({
      success: true,
      message: "Vehicle retrieved successfully",
      data: vehicle,
    });
  } catch (error) {
    next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    const validation = updateVehicleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const vehicle = await updateVehicle(req.params.id, validation.data);

    return res.status(200).json({
      success: true,
      message: "Vehicle updated successfully",
      data: vehicle,
    });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req, res, next) => {
  try {
    await deleteVehicle(req.params.id);

    return res.status(200).json({
      success: true,
      message: "Vehicle deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

import aiClient from "../../services/aiClient.service.js";

import path from "path";
import fs from "fs";

/**
 * Analyzes the preloaded project sample traffic video (traffic-video.mp4).
 */
export const analyzeSampleVideo = async (req, res, next) => {
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), "../ai-services/test-data/traffic-video.mp4"),
      path.resolve(process.cwd(), "ai-services/test-data/traffic-video.mp4"),
      "D:\\Attendance & Vehicle Detection Project\\ai-services\\test-data\\traffic-video.mp4",
    ];

    let samplePath = candidatePaths.find((p) => fs.existsSync(p));
    if (!samplePath) {
      return res.status(404).json({
        success: false,
        message: "Preloaded traffic video not found on server.",
      });
    }

    const fileBuffer = fs.readFileSync(samplePath);
    const { conf_threshold, processing_fps, save_annotated, max_frames } = req.query;

    const result = await aiClient.analyzeVehicleVideo(
      fileBuffer,
      "traffic-video.mp4",
      {
        conf_threshold: conf_threshold ? parseFloat(conf_threshold) : undefined,
        processing_fps: processing_fps ? parseFloat(processing_fps) : 2.0,
        save_annotated:
          save_annotated !== undefined
            ? save_annotated === "true" || save_annotated === true
            : false,
        max_frames: max_frames ? parseInt(max_frames, 10) : undefined,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Sample video analyzed successfully",
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Sample video analysis failed",
    });
  }
};

/**
 * Analyzes an uploaded vehicle video via the Python AI service.
 */
export const analyzeVideo = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No video file provided or uploaded file is empty (0 bytes).",
      });
    }

    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const allowed = [".mp4", ".avi", ".mov", ".mkv"];
    if (ext && !allowed.includes(ext)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported video format '${ext}'. Allowed: ${allowed.join(", ")}`,
      });
    }

    const { conf_threshold, processing_fps, save_annotated, max_frames } = req.query;

    const result = await aiClient.analyzeVehicleVideo(
      req.file.buffer,
      req.file.originalname,
      {
        conf_threshold: conf_threshold ? parseFloat(conf_threshold) : undefined,
        processing_fps: processing_fps ? parseFloat(processing_fps) : 2.0,
        save_annotated:
          save_annotated !== undefined
            ? save_annotated === "true" || save_annotated === true
            : false,
        max_frames: max_frames ? parseInt(max_frames, 10) : undefined,
      }
    );


    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Vehicle video analysis failed",
    });
  }
};

/**
 * Analyzes an uploaded vehicle image via the Python AI service.
 */
export const analyzeImage = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No image file provided or uploaded file is empty (0 bytes).",
      });
    }

    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png"];
    if (ext && !allowed.includes(ext)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported image format '${ext}'. Allowed: ${allowed.join(", ")}`,
      });
    }

    const { conf_threshold } = req.query;

    const result = await aiClient.analyzeVehicleImage(
      req.file.buffer,
      req.file.originalname,
      {
        conf_threshold: conf_threshold ? parseFloat(conf_threshold) : undefined,
      }
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Vehicle image analysis failed",
    });
  }
};


