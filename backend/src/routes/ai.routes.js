/**
 * AI Service Integration Routes.
 *
 * Exposes:
 * GET  /api/ai/health - Proxies health check to Python FastAPI AI service
 */

import { Router } from "express";
import aiClient from "../services/aiClient.service.js";
import config from "../config/env.js";

const router = Router();

router.get("/health", async (req, res) => {
  try {
    const aiHealth = await aiClient.checkHealth();
    return res.status(200).json({
      success: true,
      message: "AI service is reachable",
      aiServiceUrl: config.aiServiceUrl,
      data: aiHealth,
    });
  } catch (error) {
    // Check if camera pipeline status file exists locally even if FastAPI is temporarily unavailable
    let localCameraStatus = null;
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const statusFilePath = path.resolve(process.cwd(), "../ai-services/data/ai_camera_status.json");
      if (fs.existsSync(statusFilePath)) {
        const raw = fs.readFileSync(statusFilePath, "utf8");
        localCameraStatus = JSON.parse(raw);
      }
    } catch (_ignore) {}

    return res.status(200).json({
      success: false,
      isOnline: false,
      message: error.message || "AI service is unavailable",
      aiServiceUrl: config.aiServiceUrl,
      cameraPipeline: localCameraStatus,
    });
  }
});

export default router;
