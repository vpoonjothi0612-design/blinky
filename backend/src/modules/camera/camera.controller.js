import config from "../../config/env.js";
import http from "node:http";
import {
  createCamera,
  getAllCameras,
  getCameraById,
  updateCamera,
  deleteCamera,
  checkCameraReachability,
} from "./camera.service.js";
import { createCameraSchema, updateCameraSchema } from "./camera.zod.js";
import cameraEventListener from "../../services/cameraEventListener.service.js";

export const create = async (req, res, next) => {
  try {
    const validation = createCameraSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const camera = await createCamera(validation.data);

    return res.status(201).json({
      success: true,
      message: "Camera created successfully",
      data: camera,
    });
  } catch (error) {
    next(error);
  }
};

export const getAll = async (req, res, next) => {
  try {
    const cameras = await getAllCameras();
    const streamStatus = cameraEventListener.getStatus();

    const enriched = await Promise.all(
      cameras.map(async (c) => {
        const plain = c.toJSON ? c.toJSON() : { ...c };

        if (plain.status === "INACTIVE") {
          plain.isOnline = false;
          plain.connectionStatus = "INACTIVE";
          return plain;
        }

        const isStreamConnected =
          streamStatus.connected &&
          (streamStatus.cameraIp === plain.ipAddress ||
            streamStatus.configuredUrl?.includes(plain.ipAddress));

        if (isStreamConnected) {
          plain.isOnline = true;
          plain.connectionStatus = "ONLINE";
          return plain;
        }

        let isReachable = false;
        if (plain.ipAddress) {
          isReachable = await checkCameraReachability(plain.ipAddress, 80, 500);
          if (!isReachable) {
            isReachable = await checkCameraReachability(plain.ipAddress, 554, 400);
          }
        }

        plain.isOnline = isReachable;
        plain.connectionStatus = isReachable ? "ONLINE" : "OFFLINE";
        return plain;
      })
    );

    return res.status(200).json({
      success: true,
      message: "Cameras retrieved successfully",
      data: enriched,
    });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req, res, next) => {
  try {
    const camera = await getCameraById(req.params.id);

    return res.status(200).json({
      success: true,
      message: "Camera retrieved successfully",
      data: camera,
    });
  } catch (error) {
    next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    const validation = updateCameraSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const camera = await updateCamera(req.params.id, validation.data);

    return res.status(200).json({
      success: true,
      message: "Camera updated successfully",
      data: camera,
    });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req, res, next) => {
  try {
    await deleteCamera(req.params.id);

    return res.status(200).json({
      success: true,
      message: "Camera deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const getStreamStatus = async (req, res, next) => {
  try {
    const status = cameraEventListener.getStatus();
    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
};

export const startStream = async (req, res, next) => {
  try {
    const customUrl = req.body?.cameraApiUrl || null;
    await cameraEventListener.start(customUrl);
    const status = cameraEventListener.getStatus();
    return res.status(200).json({
      success: true,
      message: "Camera event stream started successfully",
      data: status,
    });
  } catch (error) {
    next(error);
  }
};

export const stopStream = async (req, res, next) => {
  try {
    cameraEventListener.stop();
    const status = cameraEventListener.getStatus();
    return res.status(200).json({
      success: true,
      message: "Camera event stream stopped successfully",
      data: status,
    });
  } catch (error) {
    next(error);
  }
};

export const testStreamConnection = async (req, res, next) => {
  try {
    const customUrl = req.body?.cameraApiUrl || null;
    const testResult = await cameraEventListener.testConnection(customUrl);
    return res.status(200).json({
      success: testResult.success,
      data: testResult,
    });
  } catch (error) {
    next(error);
  }
};

export const getStreamEvents = async (req, res, next) => {
  try {
    const events = cameraEventListener.getRecentEvents();
    return res.status(200).json({
      success: true,
      count: events.length,
      data: events,
    });
  } catch (error) {
    next(error);
  }
};

export const getSnapshot = async (req, res, next) => {
  try {
    const targetIp = req.query.ip || null;
    const snapshotBuffer = await cameraEventListener.fetchSnapshot(targetIp);
    if (!snapshotBuffer) {
      return res.status(502).json({
        success: false,
        message: "Failed to capture snapshot from camera (camera may be unreachable or offline)",
      });
    }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", snapshotBuffer.length);
    return res.end(snapshotBuffer);
  } catch (error) {
    next(error);
  }
};

// Helper: Generates a sleek, animated SVG camera standby graphic when the RTSP stream is not yet connected
const generateStandbySvg = (cameraId) => {
  const isEntry = cameraId.includes("02") || cameraId.includes("IN");
  const title = `${cameraId} (${isEntry ? "ENTRY GATE • IN" : "EXIT GATE • OUT"})`;
  const timeStr = new Date().toLocaleTimeString();

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0b1320" />
          <stop offset="100%" stop-color="#162238" />
        </linearGradient>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
      <rect width="100%" height="100%" fill="url(#grid)" />
      
      <!-- Biometric Active Zone Overlay -->
      <line x1="240" y1="560" x2="1040" y2="560" stroke="#ef4444" stroke-width="2" stroke-dasharray="8,6" opacity="0.8" />
      <line x1="360" y1="420" x2="920" y2="420" stroke="#eab308" stroke-width="2" stroke-dasharray="8,6" opacity="0.8" />
      <line x1="440" y1="300" x2="840" y2="300" stroke="#10b981" stroke-width="2" stroke-dasharray="8,6" opacity="0.9" />
      <text x="640" y="290" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13" font-weight="bold" fill="#10b981" text-anchor="middle">ACTIVE BIOMETRIC ZONE (4m)</text>
      
      <!-- Central HUD Card -->
      <rect x="360" y="170" width="560" height="230" rx="16" fill="#0f172a" fill-opacity="0.95" stroke="#334155" stroke-width="1.5" />
      <circle cx="400" cy="215" r="8" fill="#f59e0b" />
      <text x="420" y="222" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" font-weight="800" fill="#f8fafc">${title}</text>
      <text x="400" y="260" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="600" fill="#94a3b8">Camera Standby • Stream Ready</text>
      <text x="400" y="292" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13" fill="#64748b">Inference engine awaiting camera feed or laptop webcam</text>
      <text x="400" y="322" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13" font-weight="bold" fill="#10b981">✓ Web Dashboard Active • Real-Time Biometrics Ready</text>
      
      <!-- Top info bar -->
      <rect x="0" y="0" width="1280" height="42" fill="#050a12" fill-opacity="0.85" />
      <circle cx="28" cy="21" r="5" fill="#10b981" />
      <text x="44" y="26" font-family="monospace" font-size="13" font-weight="bold" fill="#10b981">LIVE MONITORING ACTIVE • ${cameraId}</text>
      <text x="1252" y="26" font-family="monospace" font-size="13" fill="#94a3b8" text-anchor="end">${timeStr}</text>
    </svg>
  `.trim();
};

export const getLiveCameraStream = (req, res) => {
  const cameraId = (req.params.cameraId || req.query.camera || "CAM-02").toUpperCase();
  const streamBase = (config.aiStreamUrl || process.env.AI_STREAM_URL || "http://127.0.0.1:5055").replace(/\/+$/, "");
  const aiStreamUrl = `${streamBase}/stream/${cameraId}`;

  const clientReq = http.get(aiStreamUrl, (streamRes) => {
    if (streamRes.statusCode !== 200) {
      // Send aesthetic standby SVG frame directly to keep <img> tag working gracefully
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(generateStandbySvg(cameraId));
    }

    res.writeHead(200, {
      "Content-Type": streamRes.headers["content-type"] || "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Connection": "close",
      "Access-Control-Allow-Origin": "*",
    });

    streamRes.pipe(res);

    req.on("close", () => {
      clientReq.destroy();
    });
  });

  clientReq.on("error", () => {
    if (!res.headersSent) {
      if (req.query.raw === "true") {
        return res.status(503).json({
          success: false,
          message: `AI Camera live streaming server is offline.`,
        });
      }
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(generateStandbySvg(cameraId));
    }
  });
};

export const getLiveCameraFrame = (req, res) => {
  const cameraId = (req.params.cameraId || req.query.camera || "CAM-02").toUpperCase();
  const streamBase = (config.aiStreamUrl || process.env.AI_STREAM_URL || "http://127.0.0.1:5055").replace(/\/+$/, "");
  const frameUrl = `${streamBase}/frame/${cameraId}`;

  const clientReq = http.get(frameUrl, (streamRes) => {
    if (streamRes.statusCode !== 200) {
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(generateStandbySvg(cameraId));
    }

    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    });

    streamRes.pipe(res);
  });

  clientReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(generateStandbySvg(cameraId));
    }
  });
};
