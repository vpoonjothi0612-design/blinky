import {
  createFaceEnrollment,
  getAllFaceEnrollments,
  getFaceEnrollmentById,
  getFaceEnrollmentByEmployeeId,
  updateFaceEnrollment,
  deleteFaceEnrollment,
  bulkDeleteFaceEnrollments,
  captureUnknownFace,
  getAllUnknownFaces,
  assignUnknownFace,
  registerUnknownFace,
} from "./face-enrollment.service.js";
import { createEnrollmentSchema, updateEnrollmentSchema } from "./face-enrollment.zod.js";
import { recordSurveillanceEvent } from "../event/event.service.js";
import { normalizeMediaPath, readImageDimensions, resolveMediaPath, encodeMediaKey } from "../media/media.service.js";

const validateFacePath = async (facePath) => {
  const normalized = normalizeMediaPath(facePath, "captures");
  const absolute = normalized && resolveMediaPath(normalized);
  if (!absolute) return { error: "face_passport_path must be a valid capture media path" };
  try {
    const dimensions = await readImageDimensions(absolute);
    if (!dimensions || dimensions.width < 112 || dimensions.height < 112) {
      return { error: "face_passport_path must be a valid image at least 112x112 pixels" };
    }
    return { path: normalized, dimensions };
  } catch (error) {
    if (error.code === "ENOENT") return { error: "face_passport_path does not exist" };
    throw error;
  }
};

export const validateCaptureDecision = (decision, facePath) => {
  const normalized = String(decision || '').toUpperCase();
  if ((normalized === 'UNKNOWN' || normalized === 'CONFIRMED') && !facePath) {
    return 'face_passport_path is required for UNKNOWN or CONFIRMED captures';
  }
  if (!['UNKNOWN', 'CONFIRMED', 'NO_FACE_CAPTURED'].includes(normalized)) {
    return 'decision must be UNKNOWN, CONFIRMED, or NO_FACE_CAPTURED';
  }
  return null;
};

export const create = async (req, res, next) => {
  try {
    const validation = createEnrollmentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const enrollment = await createFaceEnrollment(validation.data);
    
    return res.status(201).json({
      success: true,
      message: "Face enrollment created successfully",
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
};

export const getAll = async (req, res, next) => {
  try {
    const enrollments = await getAllFaceEnrollments();
    
    return res.status(200).json({
      success: true,
      message: "Face enrollments retrieved successfully",
      data: enrollments,
    });
  } catch (error) {
    next(error);
  }
};

export const getById = async (req, res, next) => {
  try {
    const enrollment = await getFaceEnrollmentById(req.params.id);
    
    return res.status(200).json({
      success: true,
      message: "Face enrollment retrieved successfully",
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
};

export const getByEmployeeId = async (req, res, next) => {
  try {
    const enrollment = await getFaceEnrollmentByEmployeeId(req.params.employeeId);
    
    return res.status(200).json({
      success: true,
      message: "Face enrollment retrieved successfully",
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
};

export const update = async (req, res, next) => {
  try {
    const validation = updateEnrollmentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const enrollment = await updateFaceEnrollment(req.params.id, validation.data);
    
    return res.status(200).json({
      success: true,
      message: "Face enrollment updated successfully",
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
};

export const remove = async (req, res, next) => {
  try {
    await deleteFaceEnrollment(req.params.id);
    
    return res.status(200).json({
      success: true,
      message: "Face enrollment deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const bulkRemove = async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No IDs provided for bulk delete",
      });
    }

    const count = await bulkDeleteFaceEnrollments(ids);

    return res.status(200).json({
      success: true,
      message: `${count} face enrollments deleted successfully`,
      deletedCount: count,
    });
  } catch (error) {
    next(error);
  }
};

export const captureUnknown = async (req, res, next) => {
  try {
    const {
      image, visitCount, metadata = {}, embedding, decision: suppliedDecision,
      face_path: suppliedFacePath, face_aligned_path, body_path: suppliedBodyPath,
      frame_path, face_quality_score, face_reason: suppliedFaceReason, employeeId, employeeCode,
    } = req.body;
    const noFaceLegacy = metadata.faceStatus === "NO_FACE_CAPTURED";
    const decision = String(suppliedDecision || (noFaceLegacy ? "NO_FACE_CAPTURED" : "UNKNOWN")).toUpperCase();
    const faceReason = suppliedFaceReason || (noFaceLegacy ? metadata.reason || "FACE_NOT_VISIBLE" : decision);
    // Accept the old image field only for old workers that do not send decision;
    // explicit UNKNOWN/CONFIRMED callers must supply the separate face path.
    let facePath = suppliedFacePath;
    let bodyPath = suppliedBodyPath;
    if (!suppliedDecision && !suppliedFacePath && image) {
      if (decision === "NO_FACE_CAPTURED") bodyPath = `unknown/${image}`;
      else facePath = `unknown/${image}`;
    }
    const decisionError = validateCaptureDecision(decision, facePath);
    if (decisionError) return res.status(400).json({ success: false, message: decisionError });
    const requiresFace = decision === "UNKNOWN" || decision === "CONFIRMED";

    let validatedFacePath = null;
    if (facePath) {
      const validation = await validateFacePath(facePath);
      if (validation.error) return res.status(400).json({ success: false, message: validation.error });
      validatedFacePath = validation.path;
    }
    const normalizedBodyPath = bodyPath ? normalizeMediaPath(bodyPath, "captures") : null;
    const normalizedFramePath = frame_path ? normalizeMediaPath(frame_path, "captures") : null;
    const normalizedAlignedPath = face_aligned_path ? normalizeMediaPath(face_aligned_path, "captures") : null;
    if ((bodyPath && !normalizedBodyPath) || (frame_path && !normalizedFramePath) || (face_aligned_path && !normalizedAlignedPath)) {
      return res.status(400).json({ success: false, message: "Capture paths must stay inside the media store" });
    }
    const pathFields = {
      facePassportPath: validatedFacePath,
      faceAlignedPath: normalizedAlignedPath,
      bodyPath: normalizedBodyPath,
      framePath: normalizedFramePath,
      faceQualityScore: Number.isFinite(Number(face_quality_score)) ? Number(face_quality_score) : null,
      faceReason,
      decision,
    };

    if (decision === "CONFIRMED") {
      const event = await recordSurveillanceEvent({
        cameraId: metadata.cameraId || metadata.camera || req.body.cameraId || "CAM-02",
        direction: metadata.direction || (String(metadata.camera || req.body.cameraId || "CAM-02").includes("01") ? "OUT" : "IN"),
        eventType: `PERSON_${metadata.direction || "IN"}`,
        employeeId,
        employeeCode,
        name: req.body.name || employeeCode || "Employee",
        timestamp: metadata.timestamp,
        imageFace: validatedFacePath,
        imageFrame: normalizedFramePath,
        matchScore: metadata.bestScore ?? null,
        alarm: false,
        metadata: { ...metadata, ...pathFields },
      });
      return res.status(201).json({ success: true, message: "Confirmed face capture saved", data: event });
    }

    const record = await captureUnknownFace(validatedFacePath, {
      visitCount,
      metadata: { ...metadata, ...pathFields },
      embedding,
      paths: pathFields,
    });

    // A capture in Face Registry must also become a camera event. Live Monitoring
    // reads its recent cards from SurveillanceEvent, not from FaceEnrollment.
    if (record?.id && record.status !== "REGISTERED_EMPLOYEE") {
      const cameraId = metadata?.cameraId || metadata?.camera || req.body.cameraId ||
        (String(image || "").includes("CAM-01") ? "CAM-01" : "CAM-02");
      const direction = metadata?.direction || (String(cameraId).includes("01") ? "OUT" : "IN");
      const noFace = decision === "NO_FACE_CAPTURED";
      const capturedImage = record.facePassportPath || record.photoUrl || null;

      await recordSurveillanceEvent({
        cameraId,
        direction,
        eventType: noFace ? "NO_FACE_CAPTURED" : `PERSON_UNKNOWN_${direction}`,
        timestamp: metadata?.timestamp,
        trackId: metadata?.trackId,
        name: noFace ? "Face not captured" : (record.personName || "Unknown Person"),
        department: noFace ? "Pedestrian" : "Unregistered Visitor",
        imageFace: capturedImage,
        imageFrame: normalizedFramePath,
        matchScore: metadata?.bestScore ?? null,
        alarm: !noFace,
        metadata: { ...(metadata || {}), ...pathFields, faceStatus: noFace ? "NO_FACE_CAPTURED" : "FACE_EVALUATED" },
      });
    }

    res.status(201).json({
      success: true,
      message: "Unknown face captured successfully",
      data: record,
    });
  } catch (error) {
    next(error);
  }
};

export const getUnknown = async (req, res, next) => {
  try {
    const records = await getAllUnknownFaces();
    const data = records.map((record) => {
      let notes = {};
      try { notes = typeof record.notes === "string" ? JSON.parse(record.notes) : (record.notes || {}); } catch {}
      const noFace = record.personType === "NO_FACE_CAPTURED" || notes.faceStatus === "NO_FACE_CAPTURED";
      const facePath = record.facePassportPath || (!noFace && record.photoUrl ? normalizeMediaPath(record.photoUrl, "unknown") : null);
      const scans = (record.allScans || []).map((scan) => ({
        ...scan,
        facePassportMediaKey: scan.photoUrl && !noFace && normalizeMediaPath(scan.photoUrl, "unknown")
          ? encodeMediaKey(normalizeMediaPath(scan.photoUrl, "unknown")) : null,
      }));
      return {
        ...record,
        facePassportMediaKey: facePath ? encodeMediaKey(facePath) : null,
        faceAlignedMediaKey: record.faceAlignedPath ? encodeMediaKey(record.faceAlignedPath) : null,
        bodyMediaKey: record.bodyPath ? encodeMediaKey(record.bodyPath) : null,
        frameMediaKey: notes.framePath ? encodeMediaKey(notes.framePath) : null,
        faceReason: record.faceReason || notes.faceReason || (noFace ? "FACE_NOT_VISIBLE" : null),
        faceDecision: notes.decision || (noFace ? "NO_FACE_CAPTURED" : "UNKNOWN"),
        allScans: scans,
      };
    });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const assignUnknown = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { employeeId } = req.body;
    
    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId is required" });
    }

    const record = await assignUnknownFace(id, employeeId);
    
    res.status(200).json({
      success: true,
      message: "Face assigned successfully",
      data: record,
    });
  } catch (error) {
    next(error);
  }
};

export const registerUnknown = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // All fields are optional per user request
    const record = await registerUnknownFace(id, req.body);
    
    res.status(200).json({
      success: true,
      message: "Person entry registered successfully",
      data: record,
    });
  } catch (error) {
    next(error);
  }
};
