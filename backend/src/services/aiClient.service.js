/**
 * AI Client Service.
 *
 * Dedicated HTTP client for communicating with the Python FastAPI AI service.
 * Connects Node.js backend -> Python AI service (FastAPI) at config.aiServiceUrl.
 * Uses node:http for high-reliability streaming without arbitrary client timeout caps.
 */

import http from "node:http";
import config from "../config/env.js";

class AIClient {
  constructor(baseUrl = config.aiServiceUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * Checks the health of the Python AI service.
   * Calls GET /health on the AI service.
   *
   * @returns {Promise<Object>} AI service health status payload.
   */
  async checkHealth(targetUrl = null) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(targetUrl || `${this.baseUrl}/health`);
      const req = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 80,
          path: parsedUrl.pathname + parsedUrl.search,
          method: "GET",
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, targetUrl || `${this.baseUrl}/health`).toString();
            return this.checkHealth(redirectUrl).then(resolve).catch(reject);
          }
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(json);
              } else {
                const err = new Error(`AI service returned HTTP ${res.statusCode}`);
                err.statusCode = res.statusCode;
                reject(err);
              }
            } catch (e) {
              const err = new Error("AI service returned a non-JSON health response");
              err.statusCode = 502;
              reject(err);
            }
          });
        }
      );

      const timeoutMs = config.aiServiceTimeout || 30000;
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        const err = new Error("AI service health check timed out");
        err.statusCode = 504;
        reject(err);
      });

      req.on("error", (err) => {
        const error = new Error(`AI service is unreachable: ${err.message}`);
        error.statusCode = 503;
        reject(error);
      });

      req.end();
    });
  }

  /**
   * Forwards a vehicle video file to the AI service for analysis.
   * Calls POST /api/v1/vehicle/video via robust HTTP streaming.
   *
   * @param {Buffer} fileBuffer - Video file buffer.
   * @param {string} originalFilename - Video filename (e.g. 'traffic-video.mp4').
   * @param {Object} [options] - Additional parameters (conf_threshold, processing_fps, save_annotated).
   * @returns {Promise<Object>} Structured video analysis result.
   */
  async analyzeVehicleVideo(fileBuffer, originalFilename, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(`${this.baseUrl}/api/v1/vehicle/video`);
      const boundary = "----NodeFormBoundary" + Math.random().toString(36).substring(2);

      const queryParams = new URLSearchParams();
      if (options.conf_threshold !== undefined && options.conf_threshold !== null) {
        queryParams.set("conf_threshold", options.conf_threshold);
      }
      if (options.processing_fps !== undefined && options.processing_fps !== null) {
        queryParams.set("processing_fps", options.processing_fps);
      }
      if (options.save_annotated !== undefined && options.save_annotated !== null) {
        queryParams.set("save_annotated", options.save_annotated);
      }
      if (options.max_frames !== undefined && options.max_frames !== null) {
        queryParams.set("max_frames", options.max_frames);
      }

      const queryString = queryParams.toString();

      const pathWithQuery = parsedUrl.pathname + (queryString ? `?${queryString}` : "");

      const header = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${originalFilename || "traffic-video.mp4"}"\r\n` +
          `Content-Type: video/mp4\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const payloadLength = header.length + fileBuffer.length + footer.length;

      const req = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 80,
          path: pathWithQuery,
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
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(json);
              } else {
                const errorMsg = json?.detail || json?.error || `AI service returned HTTP ${res.statusCode}`;
                const err = new Error(errorMsg);
                err.statusCode = res.statusCode >= 400 && res.statusCode < 500 ? res.statusCode : 502;
                err.aiResponse = json;
                reject(err);
              }
            } catch (e) {
              const err = new Error(`AI service returned non-JSON response: ${body.slice(0, 100)}`);
              err.statusCode = 502;
              reject(err);
            }
          });
        }
      );

      const timeoutMs = options.timeout || config.aiVideoTimeout || 1800000;
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        const err = new Error("AI video processing request timed out");
        err.statusCode = 504;
        reject(err);
      });

      req.on("error", (err) => {
        const error = new Error(`AI service is unreachable: ${err.message}`);
        error.statusCode = 503;
        reject(error);
      });

      req.write(header);
      req.write(fileBuffer);
      req.write(footer);
      req.end();
    });
  }

  /**
   * Forwards a vehicle image to the AI service for recognition.
   * Calls POST /api/v1/vehicle/recognize-image.
   *
   * @param {Buffer} fileBuffer - Image file buffer.
   * @param {string} originalFilename - Image filename.
   * @param {Object} [options] - Additional query params.
   * @returns {Promise<Object>} Image recognition result.
   */
  async analyzeVehicleImage(fileBuffer, originalFilename, options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(`${this.baseUrl}/api/v1/vehicle/recognize-image`);
      const boundary = "----NodeFormBoundary" + Math.random().toString(36).substring(2);

      const queryParams = new URLSearchParams();
      if (options.conf_threshold) {
        queryParams.set("conf_threshold", options.conf_threshold);
      }

      const queryString = queryParams.toString();
      const pathWithQuery = parsedUrl.pathname + (queryString ? `?${queryString}` : "");

      const header = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${originalFilename || "upload.jpg"}"\r\n` +
          `Content-Type: image/jpeg\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const payloadLength = header.length + fileBuffer.length + footer.length;

      const req = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 80,
          path: pathWithQuery,
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
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(json);
              } else {
                const errorMsg = json?.detail || json?.error || `AI service returned HTTP ${res.statusCode}`;
                const err = new Error(errorMsg);
                err.statusCode = res.statusCode;
                reject(err);
              }
            } catch (e) {
              const err = new Error(`AI service returned non-JSON response: ${body.slice(0, 100)}`);
              err.statusCode = 502;
              reject(err);
            }
          });
        }
      );

      const timeoutMs = options.timeout || config.aiServiceTimeout || 30000;
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        const err = new Error("AI image recognition request timed out");
        err.statusCode = 504;
        reject(err);
      });

      req.on("error", (err) => {
        const error = new Error(`AI service is unreachable: ${err.message}`);
        error.statusCode = 503;
        reject(error);
      });

      req.write(header);
      req.write(fileBuffer);
      req.write(footer);
      req.end();
    });
  }

  /**
   * Forwards a camera face snapshot to the AI service for facial recognition.
   * Calls POST /api/v1/face/recognize.
   *
   * @param {Buffer} fileBuffer - Face snapshot image buffer (JPEG/PNG).
   * @param {string} [originalFilename="camera-snapshot.jpg"] - Filename.
   * @param {string} [cameraId="API"] - Camera or lookup source identifier.
   * @param {Object} [options] - Optional recognition mode flags.
   * @returns {Promise<Object>} Face recognition results ({ success, facesDetected, results: [...] }).
   */
  async recognizeFace(fileBuffer, originalFilename = "camera-snapshot.jpg", cameraId = "API", options = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(`${this.baseUrl}/api/v1/face/recognize`);
      const boundary = "----NodeFormBoundary" + Math.random().toString(36).substring(2);

      const header = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${originalFilename}"\r\n` +
          `Content-Type: image/jpeg\r\n\r\n`
      );
      const cameraPart = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="camera_id"\r\n\r\n${cameraId}`);
      const staticSearchPart = options.staticSearch
        ? Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="static_search"\r\n\r\ntrue`)
        : Buffer.alloc(0);
      const includeFaceImagePart = options.includeFaceImage
        ? Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="include_face_image"\r\n\r\ntrue`)
        : Buffer.alloc(0);
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const payloadLength = header.length + fileBuffer.length + cameraPart.length +
        staticSearchPart.length + includeFaceImagePart.length + footer.length;

      const req = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 80,
          path: parsedUrl.pathname,
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
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(json);
              } else {
                const errorMsg = json?.detail || json?.message || `AI face service returned HTTP ${res.statusCode}`;
                const err = new Error(errorMsg);
                err.statusCode = res.statusCode;
                reject(err);
              }
            } catch (e) {
              const err = new Error(`AI service returned non-JSON face response: ${body.slice(0, 100)}`);
              err.statusCode = 502;
              reject(err);
            }
          });
        }
      );

      const timeoutMs = config.aiServiceTimeout || 30000;
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        const err = new Error("AI face recognition request timed out");
        err.statusCode = 504;
        reject(err);
      });

      req.on("error", (err) => {
        const error = new Error(`AI service is unreachable for face recognition: ${err.message}`);
        error.statusCode = 503;
        reject(error);
      });

      req.write(header);
      req.write(fileBuffer);
      req.write(cameraPart);
      if (staticSearchPart.length) req.write(staticSearchPart);
      if (includeFaceImagePart.length) req.write(includeFaceImagePart);
      req.write(footer);
      req.end();
    });
  }

  async enrollFace(fileBuffer, originalFilename = "enrollment.jpg") {
    const form = new FormData();
    form.append("file", new Blob([fileBuffer], { type: "image/jpeg" }), originalFilename);
    const response = await fetch(`${this.baseUrl}/api/v1/face/enroll`, { method: "POST", body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.detail || payload.message || `Face enrollment failed (${response.status})`);
      error.statusCode = response.status;
      throw error;
    }
    return payload;
  }

  async reloadFaceRegistry() {
    const response = await fetch(`${this.baseUrl}/api/v1/face/registry/reload`, { method: "POST" });
    if (!response.ok) throw new Error(`AI registry reload failed (${response.status})`);
    return response.json();
  }

  async deleteFaceRegistryEntry(employeeCode) {
    const response = await fetch(`${this.baseUrl}/api/v1/face/registry/${encodeURIComponent(employeeCode)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`AI registry deletion failed (${response.status})`);
    return response.json();
  }
}

export const aiClient = new AIClient();
export default aiClient;
