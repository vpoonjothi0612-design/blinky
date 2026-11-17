/**
 * CP PLUS / Dahua Camera Event Listener Service.
 *
 * Connects to the camera's AlarmMaster API:
 *   http://<camera_ip>/cpapi/AlarmMaster?action=attach&codes=[FaceDetection]
 *
 * Features:
 * 1. Persistent multipart/chunked HTTP event stream consumption.
 * 2. HTTP Digest and Basic Authentication support.
 * 3. Automatic background reconnection with exponential backoff.
 * 4. Automatic snapshot fetching upon FaceDetection event.
 * 5. Automatic facial recognition via AI Service (FastAPI).
 * 6. Automatic attendance logging & unknown face registration.
 * 7. Non-blocking error handling (never crashes backend if camera is offline).
 */

import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import config from "../config/env.js";
import aiClient from "./aiClient.service.js";
import { createAttendance } from "../modules/attendance/attendance.service.js";
import { findCameraByName } from "../modules/camera/camera.repository.js";
import { captureUnknownFace } from "../modules/face-enrollment/face-enrollment.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNKNOWN_DIR = path.resolve(__dirname, "../../../ai-services/data/unknown");

class CameraEventListenerService {
  constructor() {
    this.status = "IDLE"; // IDLE | CONNECTING | CONNECTED | RECONNECTING | STOPPED
    this.currentRequest = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.connectedAt = null;
    this.lastEventAt = null;
    this.lastError = null;
    this.isManualStop = false;

    // Diagnostic Counters
    this.stats = {
      eventsCount: 0,
      facesDetectedCount: 0,
      attendancesMarkedCount: 0,
      unknownFacesCapturedCount: 0,
    };

    // Keep history of last 50 events in memory
    this.recentEvents = [];
    this.maxRecentEvents = 50;

    // Debounce to prevent flooding when a face triggers multiple rapid events
    this.lastProcessedTimestamp = 0;
    this.debounceMs = 3000;
  }

  /**
   * Sanitizes and parses the target camera API URL.
   */
  getResolvedUrl(customUrl = null) {
    let raw = customUrl || config.cameraApiUrl;
    if (!raw) {
      raw = `http://${config.cameraIp}/cpapi/AlarmMaster?action=attach&codes=%5bFaceDetection%5d`;
    }

    // Strip trailing period or accidental spaces
    raw = raw.trim().replace(/\.+$/, "");

    // Ensure proper encoding for brackets if raw brackets are present
    if (raw.includes("[FaceDetection]")) {
      raw = raw.replace("[FaceDetection]", "%5bFaceDetection%5d");
    }

    try {
      return new URL(raw);
    } catch {
      // Fallback fallback URL
      return new URL(`http://${config.cameraIp}/cpapi/AlarmMaster?action=attach&codes=%5bFaceDetection%5d`);
    }
  }

  /**
   * Starts the camera event listener background stream.
   */
  async start() {
    this.isManualStop = false;
    if (this.status === "CONNECTED" || this.status === "CONNECTING") {
      console.log(`[CameraListener] Already running (status: ${this.status}).`);
      return;
    }

    this.connect();
  }

  /**
   * Stops the camera event listener.
   */
  stop() {
    this.isManualStop = true;
    this.status = "STOPPED";
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.currentRequest) {
      try {
        this.currentRequest.destroy();
      } catch {}
      this.currentRequest = null;
    }
    console.log("[CameraListener] Camera event listener stopped.");
  }

  /**
   * Connects to the CP PLUS AlarmMaster HTTP stream.
   */
  connect(authHeader = null) {
    if (this.isManualStop) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const targetUrl = this.getResolvedUrl();
    const isHttps = targetUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    this.status = authHeader ? "CONNECTING" : (this.reconnectAttempts > 0 ? "RECONNECTING" : "CONNECTING");
    console.log(
      `[CameraListener] Connecting to camera event stream: ${targetUrl.origin}${targetUrl.pathname}${targetUrl.search}`
    );

    const headers = {
      Accept: "multipart/x-mixed-replace, text/plain, */*",
      "User-Agent": "AttFace-CameraListener/1.0",
    };

    if (authHeader) {
      headers["Authorization"] = authHeader;
    } else if (targetUrl.username && targetUrl.password) {
      const basic = Buffer.from(`${targetUrl.username}:${targetUrl.password}`).toString("base64");
      headers["Authorization"] = `Basic ${basic}`;
    } else if (config.cameraUsername && config.cameraPassword) {
      const basic = Buffer.from(`${config.cameraUsername}:${config.cameraPassword}`).toString("base64");
      headers["Authorization"] = `Basic ${basic}`;
    }

    const requestOptions = {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: "GET",
      headers,
      timeout: 30000,
    };

    let buffer = "";

    try {
      const req = transport.request(requestOptions, (res) => {
        // Handle 401 Unauthorized -> Compute Digest Authentication
        if (res.statusCode === 401 && !authHeader) {
          const authChallenge = res.headers["www-authenticate"];
          if (authChallenge && authChallenge.toLowerCase().startsWith("digest ")) {
            const digestHeader = this.computeDigestHeader(
              "GET",
              `${targetUrl.pathname}${targetUrl.search}`,
              authChallenge,
              config.cameraUsername || targetUrl.username || "admin",
              config.cameraPassword || targetUrl.password || ""
            );
            if (digestHeader) {
              console.log("[CameraListener] Camera requested Digest Auth. Authenticating...");
              req.destroy();
              return this.connect(digestHeader);
            }
          }
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          this.handleDisconnect(new Error(`Camera returned HTTP status ${res.statusCode} (${res.statusMessage})`));
          return;
        }

        this.status = "CONNECTED";
        this.connectedAt = new Date().toISOString();
        this.reconnectAttempts = 0;
        this.lastError = null;
        console.log(`[CameraListener] SUCCESS: Connected to camera AlarmMaster stream at ${targetUrl.hostname}`);

        res.setEncoding("utf8");

        res.on("data", (chunk) => {
          buffer += chunk;
          this.parseStreamBuffer(buffer, (remaining) => {
            buffer = remaining;
          });
        });

        res.on("end", () => {
          this.handleDisconnect(new Error("Camera event stream ended by remote host"));
        });

        res.on("error", (err) => {
          this.handleDisconnect(err);
        });
      });

      this.currentRequest = req;

      req.on("timeout", () => {
        req.destroy();
        this.handleDisconnect(new Error("Connection timed out waiting for camera"));
      });

      req.on("error", (err) => {
        this.handleDisconnect(err);
      });

      req.end();
    } catch (err) {
      this.handleDisconnect(err);
    }
  }

  /**
   * Handles disconnections and schedules automatic reconnection.
   */
  handleDisconnect(err) {
    if (this.currentRequest) {
      try {
        this.currentRequest.destroy();
      } catch {}
      this.currentRequest = null;
    }

    if (this.isManualStop) {
      this.status = "STOPPED";
      return;
    }

    this.status = "RECONNECTING";
    this.lastError = err?.message || "Connection lost";
    this.reconnectAttempts += 1;

    const interval = Math.min(
      config.cameraReconnectInterval || 10000,
      Math.max(5000, this.reconnectAttempts * 2000)
    );

    console.warn(
      `[CameraListener] Camera stream disconnected (${this.lastError}). Reconnecting attempt #${this.reconnectAttempts} in ${interval / 1000}s...`
    );

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, interval);
  }

  /**
   * Parses the multipart chunk buffer looking for FaceDetection events.
   */
  parseStreamBuffer(buffer, updateBufferCallback) {
    // CP PLUS / Dahua cameras send chunked blocks separated by --myboundary or newlines:
    // Code=FaceDetection;action=Start;index=0;data={...}
    // or Code=FaceRecognition;action=Pulse;index=0;data={...}
    const eventRegex = /Code=([A-Za-z0-9_]+);action=([A-Za-z0-9_]+);(?:index=(\d+);)?(?:data=([^\r\n]+))?/g;

    let match;
    let lastIndex = 0;

    while ((match = eventRegex.exec(buffer)) !== null) {
      lastIndex = match.index + match[0].length;
      const code = match[1];
      const action = match[2];
      const channelIndex = match[3] || "0";
      const rawData = match[4] || "";

      this.handleIncomingCameraEvent(code, action, channelIndex, rawData);
    }

    // Keep leftover partial chunk
    if (lastIndex > 0) {
      updateBufferCallback(buffer.substring(lastIndex));
    } else if (buffer.length > 20000) {
      // Prevent buffer memory leak if delimiter was missed
      updateBufferCallback(buffer.substring(buffer.length - 2000));
    }
  }

  /**
   * Dispatches and processes parsed camera events.
   */
  async handleIncomingCameraEvent(code, action, index, rawData) {
    const timestamp = new Date().toISOString();
    this.lastEventAt = timestamp;
    this.stats.eventsCount += 1;

    let parsedData = null;
    if (rawData) {
      try {
        parsedData = JSON.parse(rawData);
      } catch {
        parsedData = rawData;
      }
    }

    const eventRecord = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp,
      code,
      action,
      index,
      data: parsedData,
      status: "RECEIVED",
    };

    console.log(`[CameraListener] Event received -> Code=${code}, Action=${action}, Index=${index}`);

    // Check if event is a FaceDetection or FaceRecognition trigger
    const isFaceEvent =
      code.toLowerCase().includes("face") ||
      (typeof rawData === "string" && rawData.toLowerCase().includes("face"));

    if (isFaceEvent && (action === "Start" || action === "Pulse" || !action)) {
      this.stats.facesDetectedCount += 1;

      // Debounce rapid frame bursts
      const now = Date.now();
      if (now - this.lastProcessedTimestamp < this.debounceMs) {
        eventRecord.status = "DEBOUNCED";
        this.addRecentEvent(eventRecord);
        return;
      }
      this.lastProcessedTimestamp = now;

      // Process Face Event Asynchronously
      this.processFaceDetectionEvent(eventRecord, parsedData).catch((err) => {
        console.error("[CameraListener] Error processing face event:", err.message);
      });
    }

    this.addRecentEvent(eventRecord);
  }

  /**
   * Processes FaceDetection: fetches camera snapshot, calls AI recognition, logs attendance.
   */
  async processFaceDetectionEvent(eventRecord, eventData) {
    const targetUrl = this.getResolvedUrl();
    const cameraIp = targetUrl.hostname || config.cameraIp;

    console.log(`[CameraListener] Processing face detection from camera ${cameraIp}...`);

    // 1. Fetch live snapshot from camera
    const snapshotBuffer = await this.fetchSnapshot(cameraIp);
    if (!snapshotBuffer) {
      eventRecord.status = "NO_SNAPSHOT";
      eventRecord.note = "Camera event acknowledged, but snapshot could not be fetched from camera HTTP endpoint.";
      return;
    }

    eventRecord.snapshotCaptured = true;

    // 2. Send snapshot to Python AI Face Recognition Service
    let recognitionResult;
    try {
      recognitionResult = await aiClient.recognizeFace(snapshotBuffer, `camera_${Date.now()}.jpg`, `CAM-${cameraIp}`);
    } catch (err) {
      eventRecord.status = "AI_RECOGNITION_ERROR";
      eventRecord.note = `AI service error: ${err.message}`;
      console.warn(`[CameraListener] Face recognition failed via AI service: ${err.message}`);
      return;
    }

    eventRecord.recognitionResult = recognitionResult;

    if (!recognitionResult || !recognitionResult.results || recognitionResult.results.length === 0) {
      eventRecord.status = "NO_FACES_IN_SNAPSHOT";
      return;
    }

    // 3. Find registered camera ID in database if available
    let cameraId = null;
    try {
      const cam = await findCameraByName(`CP PLUS Camera (${cameraIp})`);
      if (cam) cameraId = cam.id;
    } catch {}

    // 4. Process each face returned by AI service
    for (const face of recognitionResult.results) {
      if (face.status === "RECOGNIZED" && face.employeeId) {
        // Enrolled employee recognized -> Record Attendance
        try {
          const attResult = await createAttendance({
            employeeId: face.employeeId,
            cameraId: cameraId,
            source: "AI_CAMERA",
            timestamp: new Date(),
          });

          if (attResult.created) {
            this.stats.attendancesMarkedCount += 1;
            eventRecord.status = "ATTENDANCE_RECORDED";
            eventRecord.employee = { id: face.employeeId, name: face.name };
            console.log(
              `[CameraListener] Attendance RECORDED for ${face.name || face.employeeId} via Camera ${cameraIp}`
            );
          } else {
            eventRecord.status = "ATTENDANCE_COOLDOWN";
            eventRecord.note = attResult.message;
            console.log(
              `[CameraListener] Attendance COOLDOWN for ${face.name || face.employeeId}: ${attResult.message}`
            );
          }
        } catch (err) {
          console.error(`[CameraListener] Failed to save attendance:`, err.message);
        }
      } else {
        // Unknown face -> Save snapshot image and log unknown visitor
        try {
          if (!fs.existsSync(UNKNOWN_DIR)) {
            fs.mkdirSync(UNKNOWN_DIR, { recursive: true });
          }

          const filename = `unknown_cam_${Date.now()}.jpg`;
          const filePath = path.join(UNKNOWN_DIR, filename);
          fs.writeFileSync(filePath, snapshotBuffer);

          await captureUnknownFace(filename, {
            metadata: {
              source: "CP_PLUS_CAMERA_API",
              cameraIp,
              detectedAt: new Date().toISOString(),
            },
          });

          this.stats.unknownFacesCapturedCount += 1;
          eventRecord.status = "UNKNOWN_FACE_CAPTURED";
          eventRecord.unknownFile = filename;
          console.log(`[CameraListener] Unknown face captured and logged to Unknown Faces registry: ${filename}`);
        } catch (err) {
          console.warn(`[CameraListener] Failed to log unknown face:`, err.message);
        }
      }
    }
  }

  /**
   * Fetches a JPEG snapshot from CP PLUS / Dahua camera snapshot endpoints.
   */
  async fetchSnapshot(cameraIp) {
    const endpoints = [
      config.cameraSnapshotUrl,
      `http://${cameraIp}/cgi-bin/snapshot.cgi?channel=${config.cameraChannel || 1}`,
      `http://${cameraIp}/cpapi/snapshot?channel=${config.cameraChannel || 1}`,
      `http://${cameraIp}/cgi-bin/snapshot.cgi`,
    ].filter(Boolean);

    for (const urlStr of endpoints) {
      try {
        const buffer = await this.httpGetBuffer(urlStr);
        if (buffer && buffer.length > 1000) {
          return buffer;
        }
      } catch {
        // Continue to next snapshot endpoint candidate
      }
    }

    return null;
  }

  /**
   * Performs an HTTP GET and returns the response as a Buffer.
   */
  async httpGetBuffer(urlStr) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlStr);
      const isHttps = parsed.protocol === "https:";
      const transport = isHttps ? https : http;

      const headers = {
        Accept: "image/jpeg, image/png, */*",
      };

      if (config.cameraUsername && config.cameraPassword) {
        const basic = Buffer.from(`${config.cameraUsername}:${config.cameraPassword}`).toString("base64");
        headers["Authorization"] = `Basic ${basic}`;
      }

      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method: "GET",
          headers,
          timeout: 5000,
        },
        (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Snapshot returned HTTP ${res.statusCode}`));
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        }
      );

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Snapshot request timed out"));
      });
      req.on("error", (err) => reject(err));
      req.end();
    });
  }

  /**
   * Generates HTTP Digest Authentication header.
   */
  computeDigestHeader(method, uri, challenge, username, password) {
    try {
      const parseField = (name) => {
        const match = challenge.match(new RegExp(`${name}="?([^",]+)"?`, "i"));
        return match ? match[1] : null;
      };

      const realm = parseField("realm");
      const nonce = parseField("nonce");
      const qop = parseField("qop");
      const opaque = parseField("opaque");

      if (!realm || !nonce) return null;

      const ha1 = crypto.createHash("md5").update(`${username}:${realm}:${password}`).digest("hex");
      const ha2 = crypto.createHash("md5").update(`${method}:${uri}`).digest("hex");
      const nc = "00000001";
      const cnonce = crypto.randomBytes(8).toString("hex");

      let response;
      if (qop) {
        response = crypto
          .createHash("md5")
          .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
          .digest("hex");
      } else {
        response = crypto.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");
      }

      let authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
      if (qop) authHeader += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
      if (opaque) authHeader += `, opaque="${opaque}"`;

      return authHeader;
    } catch {
      return null;
    }
  }

  /**
   * Stores recent event in memory with limit.
   */
  addRecentEvent(event) {
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.pop();
    }
  }

  /**
   * Returns current listener status and metrics.
   */
  getStatus() {
    const resolvedUrl = this.getResolvedUrl();
    return {
      success: true,
      status: this.status,
      connected: this.status === "CONNECTED",
      cameraIp: resolvedUrl.hostname || config.cameraIp,
      configuredUrl: resolvedUrl.toString(),
      connectedAt: this.connectedAt,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      stats: { ...this.stats },
      recentEventsCount: this.recentEvents.length,
    };
  }

  /**
   * Returns recent events log.
   */
  getRecentEvents() {
    return this.recentEvents;
  }

  /**
   * Tests connection to camera API.
   */
  async testConnection(customUrl = null) {
    const targetUrl = this.getResolvedUrl(customUrl);
    const isHttps = targetUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    return new Promise((resolve) => {
      const headers = {
        Accept: "*/*",
        "User-Agent": "AttFace-CameraTester/1.0",
      };

      if (config.cameraUsername && config.cameraPassword) {
        const basic = Buffer.from(`${config.cameraUsername}:${config.cameraPassword}`).toString("base64");
        headers["Authorization"] = `Basic ${basic}`;
      }

      const startTime = Date.now();
      const req = transport.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isHttps ? 443 : 80),
          path: `${targetUrl.pathname}${targetUrl.search}`,
          method: "GET",
          headers,
          timeout: 6000,
        },
        (res) => {
          const latencyMs = Date.now() - startTime;
          const isReachable = res.statusCode < 500;
          resolve({
            success: isReachable,
            reachable: true,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            latencyMs,
            targetUrl: targetUrl.toString(),
            contentType: res.headers["content-type"],
            server: res.headers["server"] || "IP Camera",
            requiresAuth: res.statusCode === 401,
            authType: res.headers["www-authenticate"] || null,
          });
          req.destroy();
        }
      );

      req.on("timeout", () => {
        req.destroy();
        resolve({
          success: false,
          reachable: false,
          error: "Connection timed out (camera unreachable or port blocked)",
          targetUrl: targetUrl.toString(),
        });
      });

      req.on("error", (err) => {
        resolve({
          success: false,
          reachable: false,
          error: err.message,
          targetUrl: targetUrl.toString(),
        });
      });

      req.end();
    });
  }
}

export const cameraEventListener = new CameraEventListenerService();

export const startCameraEventListener = async () => {
  if (config.cameraAutoStart) {
    await cameraEventListener.start();
  }
};

export default cameraEventListener;
