import dotenv from "dotenv";

dotenv.config();

// Sanitize and resolve camera API URL with fallbacks
const resolveCameraApiUrl = () => {
  const raw =
    process.env.CAMERA_API_URL ||
    process.env.CAMERA_API ||
    process.env["CAMERA API"];

  if (raw) return raw.trim().replace(/\.+$/, "");

  const cameraIp = process.env.CAMERA_IP || process.env.CAMERA_2_IP || process.env.CAMERA_1_IP;
  return cameraIp
    ? `http://${cameraIp}/cpapi/AlarmMaster?action=attach&codes=%5bFaceDetection%5d`
    : "";
};

const cameraIp = process.env.CAMERA_IP || process.env.CAMERA_2_IP || process.env.CAMERA_1_IP || "";
const cameraApiUrl = resolveCameraApiUrl();

export const config = {
  port: process.env.PORT || 3000,
  domain: process.env.DOMAIN || "https://facetrack.gldatacenter.com",
  frontendUrl: process.env.FRONTEND_URL || "https://facetrack.gldatacenter.com",
  apiBaseUrl: process.env.API_BASE_URL || "https://facetrack.gldatacenter.com/api",
  jwtSecret: process.env.JWT_SECRET,
  aiServiceUrl: process.env.AI_SERVICE_URL || "http://127.0.0.1:8000",
  aiStreamUrl: process.env.AI_STREAM_URL || "http://127.0.0.1:5055",
  aiServiceTimeout: parseInt(process.env.AI_SERVICE_TIMEOUT, 10) || 30000,
  aiVideoTimeout: parseInt(process.env.AI_VIDEO_TIMEOUT, 10) || 1800000,

  // CP PLUS / Dahua Camera Configuration
  nvrIp: process.env.NVR_IP || "",
  camera1Ip: process.env.CAMERA_1_IP || "",
  camera2Ip: process.env.CAMERA_2_IP || "",
  cameraApiUrl,
  cameraIp,
  cameraUsername: process.env.CAMERA_USERNAME || "",
  cameraPassword: process.env.CAMERA_PASSWORD || "",
  cameraChannel: parseInt(process.env.CAMERA_CHANNEL, 10) || 1,
  cameraAutoStart: Boolean(cameraApiUrl) && process.env.CAMERA_AUTO_START !== "false",
  cameraReconnectInterval:
    parseInt(process.env.CAMERA_RECONNECT_INTERVAL_MS, 10) || 10000,
  cameraSnapshotUrl: process.env.CAMERA_SNAPSHOT_URL ||
    (cameraIp ? `http://${cameraIp}/cgi-bin/snapshot.cgi?channel=1` : ""),
  cameraRtspUrl: process.env.CAMERA_RTSP_URL ||
    (cameraIp ? `rtsp://${cameraIp}:554/cam/realmonitor?channel=1&subtype=0` : ""),
};

export default config;


