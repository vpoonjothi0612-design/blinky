import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Op } from "sequelize";
import SurveillanceEvent from "../event/event.model.js";
import Employee from "../employee/employee.model.js";
import FaceEnrollment from "../face-enrollment/face-enrollment.model.js";
import { mediaUrl, normalizeMediaPath } from "../media/media.service.js";
import { mapViewMetadata } from "../event/view-metadata.js";

const PERSON_EVENTS = ["PERSON_IN", "PERSON_OUT", "PERSON_UNKNOWN_IN", "PERSON_UNKNOWN_OUT", "NO_FACE_CAPTURED", "PERSON_NO_FACE"];
const SUMMARY_TTL_MS = 2000;
const summaryCache = new Map();
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const faceCrossingModeEnabled = () => String(process.env.FACE_CROSSING_MODE || "").toLowerCase() === "true";

const decisionFromEvent = (eventType, employeeId) => {
  if (eventType === "NO_FACE_CAPTURED" || eventType === "PERSON_NO_FACE") return "NO_FACE_CAPTURED";
  if (String(eventType || "").includes("UNKNOWN")) return "UNKNOWN";
  if (employeeId || eventType === "PERSON_IN" || eventType === "PERSON_OUT") return "CONFIRMED";
  return "UNKNOWN";
};

const resolveRegistryPhoto = (employee, {
  enrollmentRoot = path.resolve(MODULE_DIR, "../../../../ai-services/data/enrollment"),
  fileExists = fs.existsSync,
} = {}) => {
  const enrollment = employee?.faceEnrollment;
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(employee?.employeeCode || "") || !enrollment) return null;
  const raw = enrollment.photoUrl;
  const enrollmentDir = path.join(enrollmentRoot, employee.employeeCode);
  const normalized = raw && !String(raw).startsWith("data:") ? normalizeMediaPath(raw, "enrollment") : null;
  const fileFromStoredPath = normalized?.startsWith(`enrollment/${employee.employeeCode}/`)
    ? path.basename(normalized) : null;
  const possibleNames = [fileFromStoredPath, `${employee.employeeCode}_angle_01_photo_1.jpg`].filter(Boolean);
  const filename = possibleNames.find((name) => fileExists(path.join(enrollmentDir, name)));
  return filename
    ? `/employee-images/${encodeURIComponent(employee.employeeCode)}/${encodeURIComponent(filename)}`
    : null;
};

const objectJson = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
};

export const mapCrossing = (value, photoOptions) => {
  const event = value?.toJSON ? value.toJSON() : value;
  const metadata = objectJson(event.metadata);
  const decision = decisionFromEvent(event.eventType, event.employeeId);
  const rawReason = event.faceReason || event.reason || metadata.faceReason || metadata.face_reason || metadata.reason || "";
  const faceStatus = decision === "NO_FACE_CAPTURED"
    ? (() => {
      const reason = String(rawReason).toUpperCase();
      if (reason.includes("TURNED") || reason.includes("LOOKING DOWN") || reason.includes("YAW") || reason.includes("PITCH")) return "FACE_TURNED_AWAY";
      if (reason.includes("SMALL")) return "FACE_TOO_SMALL";
      if (reason.includes("QUALITY") || reason.includes("BLUR") || reason.includes("DARK")) return "FACE_QUALITY_LOW";
      return "FACE_NOT_VISIBLE";
    })()
    : "FACE_OK";
  const employee = event.employee || null;
  const employeeName = employee
    ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim()
    : event.name && !["Unknown Person", "Unknown", "Face not captured"].includes(event.name) ? event.name : null;
  const employeePhotoUrl = resolveRegistryPhoto(employee, photoOptions);
  // A NO_FACE_CAPTURED decision can still have a detected face rejected for
  // pose/size/quality. Keep that review crop; otherwise use the saved person crop.
  const facePath = metadata.facePassportPath || metadata.face_passport_path || event.facePassportPath || event.imageFace;
  const normalizedFacePath = facePath ? normalizeMediaPath(facePath, "captures") : null;
  const facePassportUrl = normalizedFacePath ? mediaUrl(normalizedFacePath) : null;
  const framePath = metadata.framePath || metadata.frame_path || event.imageFrame;
  const bodyPath = metadata.bodyPath || metadata.body_path;
  const frameUrl = framePath ? mediaUrl(normalizeMediaPath(framePath, "captures")) : null;
  const bodyUrl = bodyPath ? mediaUrl(normalizeMediaPath(bodyPath, "captures")) : null;
  let photoUrl = null;
  let photoSource = "PLACEHOLDER";
  if (event.employeeId && employeePhotoUrl) {
    photoUrl = employeePhotoUrl;
    photoSource = "REGISTRY";
  } else if (facePassportUrl) {
    photoUrl = facePassportUrl;
    photoSource = "CAPTURE";
  } else if (decision === "NO_FACE_CAPTURED" && bodyUrl) {
    photoUrl = bodyUrl;
    photoSource = "BODY_CROP";
  } else if (decision === "NO_FACE_CAPTURED" && frameUrl) {
    photoUrl = frameUrl;
    photoSource = "FRAME";
  }
  const detectedAt = event.detectedAt || event.timestamp || event.createdAt;
  const parsed = detectedAt ? new Date(detectedAt) : null;
  return {
    id: event.id,
    direction: event.direction || (String(event.cameraId).includes("01") ? "OUT" : "IN"),
    camera_id: event.cameraId,
    detected_at: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    decision,
    face_status: faceStatus,
    employee_id: event.employeeId || null,
    employee_name: employeeName,
    employee_code: employee?.employeeCode || event.employeeCode || null,
    face_enrollment_id: employee?.faceEnrollment?.id || null,
    employee_photo_url: employeePhotoUrl,
    face_passport_url: facePassportUrl,
    frame_url: frameUrl,
    body_url: bodyUrl,
    photo_url: photoUrl,
    photo_source: photoSource,
    ...mapViewMetadata(metadata),
    reason: String(rawReason || (decision === "NO_FACE_CAPTURED" ? "No usable face was captured" : "" )).slice(0, 180),
    event_type: event.eventType,
  };
};

const includeEmployee = [{
  model: Employee,
  as: "employee",
  attributes: ["id", "employeeCode", "firstName", "lastName"],
  required: false,
  include: [{ model: FaceEnrollment, as: "faceEnrollment", attributes: ["id", "photoUrl"], required: false }],
}];

export const fetchCrossings = async ({ camera_id, decision, page = 1, limit = 25, sort = "desc", EventModel = SurveillanceEvent } = {}) => {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 25));
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const where = { eventType: { [Op.in]: PERSON_EVENTS } };
  if (camera_id) where.cameraId = camera_id;
  if (decision) {
    const normalizedDecision = String(decision).toUpperCase();
    if (normalizedDecision === "CONFIRMED") where.eventType = { [Op.in]: ["PERSON_IN", "PERSON_OUT"] };
    else if (normalizedDecision === "UNKNOWN") where.eventType = { [Op.in]: ["PERSON_UNKNOWN_IN", "PERSON_UNKNOWN_OUT"] };
    else if (normalizedDecision === "NO_FACE_CAPTURED") where.eventType = { [Op.in]: ["NO_FACE_CAPTURED", "PERSON_NO_FACE"] };
    else where.eventType = "__NO_SUCH_DECISION__";
  }
  const result = await EventModel.findAndCountAll({
    where,
    include: includeEmployee,
    order: [["createdAt", String(sort).toLowerCase() === "asc" ? "ASC" : "DESC"]],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    distinct: true,
  });
  return { rows: result.rows.map((row) => mapCrossing(row)), page: safePage, limit: safeLimit, total: result.count };
};

export const getCrossingById = async (id, EventModel = SurveillanceEvent) => {
  const event = await EventModel.findByPk(id, { include: includeEmployee });
  if (!event) return null;
  return mapCrossing(event);
};

export const getCrossingSummary = async ({ limit = 5, EventModel = SurveillanceEvent, now = Date.now() } = {}) => {
  const safeLimit = Math.min(5, Math.max(1, Number.parseInt(limit, 10) || 5));
  const cacheKey = `summary:${safeLimit}`;
  const cached = summaryCache.get(cacheKey);
  if (EventModel === SurveillanceEvent && cached && now - cached.at < SUMMARY_TTL_MS) return cached.data;
  const [entry, exit] = await Promise.all([
    fetchCrossings({ camera_id: "CAM-02", limit: safeLimit, EventModel }),
    fetchCrossings({ camera_id: "CAM-01", limit: safeLimit, EventModel }),
  ]);
  const data = { "CAM-02": entry.rows, "CAM-01": exit.rows };
  if (EventModel === SurveillanceEvent) summaryCache.set(cacheKey, { at: now, data });
  return data;
};
