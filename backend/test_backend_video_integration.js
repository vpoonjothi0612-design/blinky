/**
 * End-to-End Verification Script:
 * Tests the complete flow:
 * Client -> Node.js Backend (:3000) -> Python FastAPI (:8000) -> Node.js Backend -> Client
 */

import fs from "fs";
import http from "node:http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const videoPath = path.resolve(__dirname, "../ai-services/test-data/traffic-video.mp4");
const BACKEND_URL = "http://localhost:3000";

function postVideoToBackend(fileBuffer, originalFilename, queryParams = "") {
  return new Promise((resolve, reject) => {
    const boundary = "----TestBoundary" + Math.random().toString(36).substring(2);
    const header = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${originalFilename}"\r\n` +
        `Content-Type: video/mp4\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payloadLength = header.length + fileBuffer.length + footer.length;

    const req = http.request(
      {
        hostname: "localhost",
        port: 3000,
        path: `/api/vehicle/video${queryParams ? `?${queryParams}` : ""}`,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": payloadLength,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            resolve({ status: res.statusCode, data: json });
          } catch (e) {
            reject(new Error(`Failed to parse backend response: ${body.slice(0, 100)}`));
          }
        });
      }
    );

    req.setTimeout(1800000, () => {
      req.destroy();
      reject(new Error("Client request to Node.js backend timed out after 30 minutes"));
    });

    req.on("error", (err) => {
      reject(new Error(`Connection to Node backend failed: ${err.message}`));
    });

    req.write(header);
    req.write(fileBuffer);
    req.write(footer);
    req.end();
  });
}

async function runIntegrationTest() {
  console.log("============================================================");
  console.log("NODE.JS BACKEND <-> AI SERVICE INTEGRATION TEST");
  console.log("============================================================");

  // 1. Health check
  console.log("\n[TEST 1] Testing Backend -> AI Health...");
  const healthRes = await fetch(`${BACKEND_URL}/api/ai/health`);
  const healthData = await healthRes.json();
  console.log("  Health Status Code:", healthRes.status);
  console.log("  Health Response   :", JSON.stringify(healthData));

  if (!healthRes.ok || !healthData.success) {
    throw new Error(`Health check failed: ${JSON.stringify(healthData)}`);
  }
  console.log("  [PASS] Health check verified.");

  // 2. Invalid upload testing
  console.log("\n[TEST 2] Testing Invalid/Empty Video Upload...");
  const emptyForm = new FormData();
  emptyForm.append("file", new Blob([new Uint8Array(0)]), "empty.mp4");
  const emptyRes = await fetch(`${BACKEND_URL}/api/vehicle/video`, {
    method: "POST",
    body: emptyForm,
  });
  const emptyData = await emptyRes.json();
  console.log("  Empty upload status:", emptyRes.status, emptyData.message);
  if (emptyRes.status !== 400) {
    throw new Error(`Expected 400 on empty upload, got ${emptyRes.status}`);
  }
  console.log("  [PASS] Empty file correctly rejected with 400.");

  // 3. Full Video Upload through Backend
  console.log("\n[TEST 3] Testing Full Video Upload through Node.js Backend...");
  console.log(`  Reading traffic video from: ${videoPath}`);
  const fileBuffer = fs.readFileSync(videoPath);
  console.log(`  File size: ${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

  const tStart = Date.now();
  console.log("  Posting to POST http://localhost:3000/api/vehicle/video?processing_fps=1.0 ...");
  const response = await postVideoToBackend(fileBuffer, "traffic-video.mp4", "processing_fps=1.0");

  const durationSec = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`  Response received in ${durationSec}s. HTTP Status: ${response.status}`);

  const jsonResult = response.data;

  if (response.status !== 200 || !jsonResult.success) {
    console.error("  Error response:", JSON.stringify(jsonResult, null, 2));
    throw new Error(`Video processing failed with HTTP ${response.status}: ${jsonResult.message}`);
  }

  const data = jsonResult.data;
  console.log("\n============================================================");
  console.log("INTEGRATION RESPONSE VERIFICATION");
  console.log("============================================================");
  console.log("Source              :", data.source);
  console.log("Duration            :", data.duration, `(${data.videoDuration})`);
  console.log("Processed At        :", data.processedAt);
  console.log("Total Vehicles      :", data.vehicleCount);
  console.log("Vehicle Classes     :", JSON.stringify(data.vehicleClassCounts));
  console.log("Total Events        :", data.events?.length);
  console.log("Output Video        :", data.outputVideo);

  const vehicles = data.vehicles || [];
  console.log(`\nInspecting ${vehicles.length} vehicle entries:`);

  // Verify first 5 vehicles
  for (let i = 0; i < Math.min(5, vehicles.length); i++) {
    const v = vehicles[i];
    console.log(
      `  Track #${v.trackId}: ${v.vehicleType} (Conf: ${v.vehicleConfidence}) | Plate: ${v.numberPlate || "null"} (${v.ocrStatus}) | Direction: ${v.direction || "null"} | Time: ${v.videoTimestamp}`
    );
  }

  // Verification checks:
  const recognizedPlates = vehicles.filter((v) => v.numberPlate !== null);
  const unreadablePlates = vehicles.filter((v) => v.numberPlate === null);

  console.log(`\nPlates Recognized   : ${recognizedPlates.length}`);
  console.log(`Plates Unreadable   : ${unreadablePlates.length}`);

  // Invariant checks:
  for (const v of vehicles) {
    if (v.make !== null || v.model !== null || v.makeModelStatus !== "NOT_SUPPORTED") {
      throw new Error(`Invalid make/model invariant on vehicle track #${v.trackId}`);
    }
    if (v.numberPlate === null) {
      if (v.plateConfidence !== null || v.ocrStatus !== "PLATE_NOT_RECOGNIZED") {
        throw new Error(`Invalid null plate structure on vehicle track #${v.trackId}`);
      }
    } else {
      if (typeof v.numberPlate !== "string" || v.plateConfidence === null || v.ocrStatus !== "RECOGNIZED") {
        throw new Error(`Invalid recognized plate structure on vehicle track #${v.trackId}`);
      }
    }
  }

  console.log("\n[PASS] All schema and data invariants verified successfully!");
  console.log("============================================================\n");
  return true;
}

runIntegrationTest()
  .then(() => {
    console.log("INTEGRATION TEST PASSED SUCCESSFULLY!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("INTEGRATION TEST FAILED:", err);
    process.exit(1);
  });
