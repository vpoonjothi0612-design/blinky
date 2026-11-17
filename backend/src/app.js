import fs from "fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import routes from "./routes/index.js";
import employeeImageRoutes from "./modules/media/employee-image.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const unknownImagesPath = path.resolve(__dirname, "../../ai-services/data/unknown");
const capturedImagesPath = path.resolve(__dirname, "../../ai-services/data/captures");
const enrollmentImagesPath = path.resolve(__dirname, "../../ai-services/data/enrollment");
const vehicleImagesPath = path.resolve(__dirname, "../../ai-services/data/vehicle");
const animalImagesPath = path.resolve(__dirname, "../../ai-services/data/animal");
const snapshotImagesPath = path.resolve(__dirname, "../../ai-services/data/snapshots");

[unknownImagesPath, capturedImagesPath, enrollmentImagesPath, vehicleImagesPath, animalImagesPath, snapshotImagesPath].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const app = express();

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow serving images cross-origin
  })
);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Logging
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// API Routes
app.use("/employee-images", employeeImageRoutes);
app.use("/api", routes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Global Error Handler
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);

  const statusCode = error.status || error.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: error.message || "Internal server error",
  });
});

export default app;
