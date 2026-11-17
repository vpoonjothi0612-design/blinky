import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { fileURLToPath } from 'url';

import {
  createFaceEnrollment as createRepo,
  findAllFaceEnrollments,
  findFaceEnrollmentById,
  findFaceEnrollmentByEmployeeId,
  updateFaceEnrollment as updateRepo,
  deleteFaceEnrollment as deleteRepo,
  deleteBulkFaceEnrollments as deleteBulkRepo,
  findUnknownFaceEnrollments,
  findRecentUnregisteredFace,
} from "./face-enrollment.repository.js";
import { getEmployeeById } from "../employee/employee.service.js";
import aiClient from "../../services/aiClient.service.js";
import { normalizeMediaPath, resolveMediaPath } from "../media/media.service.js";

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to AI services data folder
const AI_ENROLLMENT_DIR = path.resolve(__dirname, '../../../../ai-services/data/enrollment');
const AI_SERVICES_DIR = path.resolve(__dirname, '../../../../ai-services');
// Keep registry cleanup and unknown-capture filtering aligned with the live
// ArcFace decision threshold. A lower fixed cutoff was silently discarding
// genuine unknown visitors that the camera had correctly rejected.
const UNKNOWN_EMPLOYEE_MATCH_THRESHOLD = Number(
  process.env.RECOGNITION_THRESHOLD || process.env.FACE_RECOGNITION_THRESHOLD || '0.48'
);

const getPythonExecutable = () => {
  const candidates = [
    path.join(AI_SERVICES_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(AI_SERVICES_DIR, 'venv', 'Scripts', 'python.exe'),
    path.join(AI_SERVICES_DIR, '.venv', 'bin', 'python'),
    path.join(AI_SERVICES_DIR, 'venv', 'bin', 'python'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return process.platform === 'win32' ? 'python' : 'python3';
};

export const createFaceEnrollment = async (data) => {
  const employee = await getEmployeeById(data.employeeId); 

  const existing = await findFaceEnrollmentByEmployeeId(data.employeeId);
  if (existing) {
    const error = new Error("Employee already has a face enrollment");
    error.statusCode = 409;
    throw error;
  }

  // Ensure AI enrollment directory exists for this employee
  const employeeCode = employee.employeeCode;
  const empDir = path.join(AI_ENROLLMENT_DIR, employeeCode);
  
  let acceptedEmbeddings = [];
  const photoResults = [];
  const imageEntries = data.images?.photos?.map((image, index) => [image, `photo_${index + 1}.jpg`]) ||
    [data.images?.front, data.images?.left, data.images?.right].filter(Boolean).map((image, index) => [image, `photo_${index + 1}.jpg`]);
  if (imageEntries.length < 3 || imageEntries.length > 5) {
    const error = new Error("Add between 3 and 5 face photos to enroll this employee; the first should be frontal.");
    error.statusCode = 400;
    throw error;
  }
  if (data.images) {
    if (!fs.existsSync(empDir)) {
      fs.mkdirSync(empDir, { recursive: true });
    }

    // Save images from base64
    const saveImage = (base64Str, filename) => {
      if (!base64Str) return;
      const base64Data = base64Str.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(path.join(empDir, filename), base64Data, 'base64');
    };

    for (const [index, [photo, filename]] of imageEntries.entries()) {
      const base64Data = photo.replace(/^data:image\/\w+;base64,/, "");
      let result;
      try {
        result = await aiClient.enrollFace(Buffer.from(base64Data, "base64"), filename);
      } catch (cause) {
        const error = new Error(`${filename}: ${cause.message}`);
        error.statusCode = cause.statusCode || 400;
        throw error;
      }
      photoResults.push({ filename, accepted: true, ...result.metadata });
      acceptedEmbeddings.push(result.embedding);
    }
    if (photoResults[0]?.pose !== "FRONT") {
      const error = new Error("The first selected photo must show a clear frontal face.");
      error.statusCode = 400;
      throw error;
    }
    await rejectDuplicateIdentity(acceptedEmbeddings, data.employeeId);
    for (const [index, [photo, filename]] of imageEntries.entries()) {
      saveImage(photo, `${employeeCode}_angle_${String(index + 1).padStart(2, '0')}_${filename}`);
    }

    // Call existing Python AI multi-angle enrollment functionality
    try {
      const scriptPath = path.join(AI_SERVICES_DIR, 'src', 'face', 'recognition', 'multi_employee_enrollment.py');
      const pythonExe = getPythonExecutable();
      const name = `${employee.firstName} ${employee.lastName || ''}`.trim();
      const command = `"${pythonExe}" "${scriptPath}" --employee "${employeeCode}" --name "${name}"`;
      
      console.log('Running AI face enrollment command:', command);
      const { stdout, stderr } = await execPromise(command, { cwd: AI_SERVICES_DIR });
      console.log('AI Enrollment Output:', stdout);
      if (stderr) console.warn('AI Enrollment Stderr:', stderr);
    } catch (err) {
      console.error('Failed to run AI enrollment script:', err);
      let errorMsg = "AI face enrollment extraction failed.";
      if (err.stdout && err.stdout.includes("Enrollment aborted")) {
        const match = err.stdout.match(/Enrollment aborted[^\n\r]+/);
        if (match) errorMsg = match[0];
      } else if (err.stderr && err.stderr.trim()) {
        const lines = err.stderr.trim().split('\n').filter(Boolean);
        const lastLine = lines[lines.length - 1];
        if (lastLine) errorMsg = `Face extraction error: ${lastLine}`;
      } else if (err.message) {
        errorMsg = `Face extraction failed: ${err.message}`;
      }
      const error = new Error(errorMsg);
      error.statusCode = 500;
      throw error;
    }
  }

  // Load Python-generated 512-D ArcFace multiview vector from .npy store
  const npyPath = path.join(AI_SERVICES_DIR, 'data', 'face_embeddings', `${employeeCode}_multiview_v2.npy`);
  const npyEmb = readNpyFloat32(npyPath);
  data.embeddings = acceptedEmbeddings.length ? acceptedEmbeddings : (npyEmb ? [npyEmb] : []);
  data.embedding = data.embeddings.length ? normalizeMean(data.embeddings) : [];
  data.embeddingModel = "InsightFace ArcFace w600k_r50";
  data.embeddingModelVersion = "w600k_r50.onnx";

  const created = await createRepo(data);
  created.setDataValue("photoResults", photoResults);
  await aiClient.reloadFaceRegistry();

  // Automatically remove any unknown faces that match this newly registered employee
  try {
    await purgeUnknownFacesMatchingEmployee(data.embedding, employeeCode);
  } catch (err) {
    console.warn(`[FaceService] Post-enrollment purge error:`, err.message);
  }

  return created;
};

const normalizeMean = (vectors) => {
  const mean = vectors[0].map((_, i) => vectors.reduce((sum, vector) => sum + Number(vector[i] || 0), 0) / vectors.length);
  const norm = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0)) || 1;
  return mean.map((value) => value / norm);
};

const rejectDuplicateIdentity = async (candidateEmbeddings, excludedEmployeeId) => {
  const existing = await findAllFaceEnrollments();
  for (const record of existing) {
    if (!record.employeeId || record.employeeId === excludedEmployeeId) continue;
    const references = [record.embedding, ...(Array.isArray(record.embeddings) ? record.embeddings : [])]
      .filter((vector) => Array.isArray(vector) && vector.length === 512);
    for (const candidate of candidateEmbeddings) {
      if (!Array.isArray(candidate) || candidate.length !== 512) continue;
      for (const reference of references) {
        const score = computeCosineSimilarity(candidate, reference);
        if (score >= 0.6) {
          const error = new Error(`This face is already enrolled for another employee (similarity ${score.toFixed(3)}).`);
          error.statusCode = 409;
          throw error;
        }
      }
    }
  }
};

export const getAllFaceEnrollments = async () => {
  return findAllFaceEnrollments();
};

export const getFaceEnrollmentById = async (id) => {
  const enrollment = await findFaceEnrollmentById(id);
  if (!enrollment) {
    const error = new Error("Face enrollment not found");
    error.statusCode = 404;
    throw error;
  }
  return enrollment;
};

export const getFaceEnrollmentByEmployeeId = async (employeeId) => {
  const enrollment = await findFaceEnrollmentByEmployeeId(employeeId);
  if (!enrollment) {
    const error = new Error("Face enrollment not found");
    error.statusCode = 404;
    throw error;
  }
  return enrollment;
};

export const updateFaceEnrollment = async (id, data) => {
  const enrollment = await findFaceEnrollmentById(id);
  if (!enrollment) {
    const error = new Error("Face enrollment not found");
    error.statusCode = 404;
    throw error;
  }

  if (data.employeeId && data.employeeId !== enrollment.employeeId) {
    const error = new Error("Cannot change employeeId of an existing enrollment");
    error.statusCode = 400;
    throw error;
  }

  if (data.images && (data.images.photos?.length || data.images.front || data.images.left || data.images.right)) {
    const employee = await getEmployeeById(enrollment.employeeId);
    const employeeCode = employee.employeeCode;
    const empDir = path.join(AI_ENROLLMENT_DIR, employeeCode);
    fs.mkdirSync(empDir, { recursive: true });
    const imageEntries = data.images.photos?.map((image) => image) ||
      [data.images.front, data.images.left, data.images.right].filter(Boolean);
    if (imageEntries.length < 3 || imageEntries.length > 5) {
      const error = new Error("Add between 3 and 5 face photos to update this enrollment; the first should be frontal.");
      error.statusCode = 400;
      throw error;
    }
    const embeddings = [];
    for (const [index, image] of imageEntries.entries()) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const filename = `${employeeCode}_angle_${String(index + 1).padStart(2, '0')}_photo_${index + 1}.jpg`;
      embeddings.push((await aiClient.enrollFace(Buffer.from(base64Data, "base64"), filename)).embedding);
    }
    await rejectDuplicateIdentity(embeddings, enrollment.employeeId);
    for (const oldImage of fs.readdirSync(empDir).filter((name) => name.startsWith(`${employeeCode}_angle_`))) {
      fs.unlinkSync(path.join(empDir, oldImage));
    }
    for (const [index, image] of imageEntries.entries()) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const filename = `${employeeCode}_angle_${String(index + 1).padStart(2, '0')}_photo_${index + 1}.jpg`;
      fs.writeFileSync(path.join(empDir, filename), base64Data, 'base64');
    }
    const scriptPath = path.join(AI_SERVICES_DIR, 'src', 'face', 'recognition', 'multi_employee_enrollment.py');
    const pythonExe = getPythonExecutable();
    const name = `${employee.firstName} ${employee.lastName || ''}`.trim();
    await execPromise(`"${pythonExe}" "${scriptPath}" --employee "${employeeCode}" --name "${name}"`, { cwd: AI_SERVICES_DIR });
    data.embeddings = embeddings;
    data.embedding = normalizeMean(embeddings);
    data.embeddingModel = "InsightFace ArcFace w600k_r50";
    data.embeddingModelVersion = "w600k_r50.onnx";
    await aiClient.reloadFaceRegistry();
  }

  const updated = await updateRepo(enrollment, data);
  return updated;
};

export const deleteFaceEnrollment = async (id) => {
  const enrollment = await findFaceEnrollmentById(id);
  if (!enrollment) {
    const error = new Error("Face enrollment not found");
    error.statusCode = 404;
    throw error;
  }
  
  await deleteRepo(enrollment);
  const employee = await getEmployeeById(enrollment.employeeId);
  if (employee?.employeeCode) await aiClient.deleteFaceRegistryEntry(employee.employeeCode);
  
  return true;
};


// Helper: Parse .npy file float32 vector in pure Node.js
const readNpyFloat32 = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    const magic = buf.subarray(0, 6).toString('latin1');
    if (magic !== '\x93NUMPY') return null;
    const headerLen = buf.readUInt16LE(8);
    const dataOffset = 10 + headerLen;
    const floatCount = (buf.length - dataOffset) / 4;
    const floats = [];
    for (let i = 0; i < floatCount; i++) {
      floats.push(buf.readFloatLE(dataOffset + i * 4));
    }
    return floats;
  } catch (err) {
    console.warn(`[FaceService] Failed to read npy file ${filePath}:`, err.message);
    return null;
  }
};

export const bulkDeleteFaceEnrollments = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0;
  }
  return deleteBulkRepo(ids);
};

// Cosine similarity between two vectors
const computeCosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB || !Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecB.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < len; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

// Retrieve all multiview embeddings for all registered employees from DB and .npy files
export const getAllRegisteredEmployeeVectors = async () => {
  const vectors = [];

  // 1. From PostgreSQL face_enrollments where employee_id IS NOT NULL
  try {
    const enrolledEmployees = await findAllFaceEnrollments();
    for (const empRecord of enrolledEmployees) {
      if (empRecord.embedding && Array.isArray(empRecord.embedding) && empRecord.embedding.length === 512) {
        vectors.push({
          employeeId: empRecord.employeeId,
          employeeCode: empRecord.employee ? empRecord.employee.employeeCode : 'registered',
          embedding: empRecord.embedding,
          source: 'db',
        });
      }
    }
  } catch (err) {
    console.warn('[FaceService] Warning querying DB employee enrollments:', err.message);
  }

  // 2. From ai-services/data/face_embeddings/*.npy (all multi-angle & multiview embeddings)
  const embDir = path.join(AI_SERVICES_DIR, 'data', 'face_embeddings');
  if (fs.existsSync(embDir)) {
    try {
      const files = fs.readdirSync(embDir).filter((f) => f.endsWith('.npy'));
      for (const f of files) {
        const empCode = f.split('_')[0];
        const emb = readNpyFloat32(path.join(embDir, f));
        if (emb && emb.length === 512) {
          vectors.push({
            employeeCode: empCode,
            embedding: emb,
            source: f,
          });
        }
      }
    } catch (err) {
      console.warn('[FaceService] Warning loading npy employee embeddings:', err.message);
    }
  }

  return vectors;
};

// Auto-purge any unrecognized faces from DB & disk that match an employee
export const purgeUnknownFacesMatchingEmployee = async (empEmbeddingOrVectors, employeeIdentifier = 'registered') => {
  const allUnknownFaces = await findUnknownFaceEnrollments();
  if (!allUnknownFaces || allUnknownFaces.length === 0) return 0;

  let targetVectors = [];
  if (Array.isArray(empEmbeddingOrVectors)) {
    if (empEmbeddingOrVectors.length > 0 && typeof empEmbeddingOrVectors[0] === 'number') {
      targetVectors = [{ employeeCode: employeeIdentifier, embedding: empEmbeddingOrVectors }];
    } else {
      targetVectors = empEmbeddingOrVectors;
    }
  } else {
    targetVectors = await getAllRegisteredEmployeeVectors();
  }

  if (targetVectors.length === 0) return 0;

  let purgedCount = 0;
  for (const record of allUnknownFaces) {
    let recEmb = record.embedding;
    if ((!recEmb || !Array.isArray(recEmb) || recEmb.length === 0) && record.photoUrl) {
      recEmb = await extractEmbeddingFromImage(record.photoUrl);
      if (recEmb) {
        await updateRepo(record, { embedding: recEmb });
        record.embedding = recEmb;
      }
    }

    if (recEmb && Array.isArray(recEmb) && recEmb.length > 0) {
      let isMatch = false;
      let matchCode = '';
      let matchSim = 0;

      for (const ref of targetVectors) {
        const sim = computeCosineSimilarity(recEmb, ref.embedding);
        if (sim >= UNKNOWN_EMPLOYEE_MATCH_THRESHOLD) {
          isMatch = true;
          matchCode = ref.employeeCode || employeeIdentifier;
          matchSim = sim;
          break;
        }
      }

      if (isMatch) {
        console.log(`[FaceService] Auto-purging unrecognized face ${record.id} (${record.photoUrl}) - matches employee ${matchCode} (Sim: ${matchSim.toFixed(4)})`);
        await deleteRepo(record);
        purgedCount++;

        if (record.facePassportPath || record.photoUrl) {
          const filePath = resolveMediaPath(record.facePassportPath || record.photoUrl);
          if (filePath && fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch {}
          }
        }
      }
    }
  }

  return purgedCount;
};

// Helper: Extract ArcFace embedding from image file if missing
const extractEmbeddingFromImage = async (imageFilename) => {
  try {
    const pythonExe = getPythonExecutable();
    const scriptPath = path.join(AI_SERVICES_DIR, 'src', 'face', 'recognition', 'extract_face_embedding.py');
    const normalized = normalizeMediaPath(imageFilename, 'unknown');
    const imagePath = normalized ? resolveMediaPath(normalized) : null;
    if (!imagePath) return null;
    const command = `"${pythonExe}" "${scriptPath}" "${imagePath}"`;
    const { stdout } = await execPromise(command, { cwd: AI_SERVICES_DIR, timeout: 5000 });
    const parsed = JSON.parse(stdout.trim());
    if (Array.isArray(parsed) && parsed.length === 512) {
      return parsed;
    }
  } catch (err) {
    console.warn(`[FaceService] Could not extract embedding for ${imageFilename}:`, err.message);
  }
  return null;
};

export const captureUnknownFace = async (imageFilename, options = {}) => {
  const { visitCount = 1, metadata = {} } = options;
  let liveEmbedding = options.embedding;
  const paths = options.paths || {};
  const decision = String(paths.decision || metadata.decision || "UNKNOWN").toUpperCase();

  // Body-only captures are review events, not biometric unknowns. Keep them in
  // the existing registry list with no embedding and avoid attempting to extract
  // an identity vector from a body crop.
  if (decision === "NO_FACE_CAPTURED" || metadata.faceStatus === "NO_FACE_CAPTURED") {
    const capturedAt = metadata.timestamp || new Date().toISOString();
    const camera = metadata.camera || metadata.cameraId || paths.cameraId || "CAM-02";
    const direction = metadata.direction || (camera.includes("CAM-02") ? "IN" : "OUT");
    const notes = JSON.stringify({
      personName: "Face not captured",
      faceStatus: "NO_FACE_CAPTURED",
      decision,
      framePath: paths.framePath || null,
      bodyPath: paths.bodyPath || null,
      faceReason: paths.faceReason || metadata.face_reason || metadata.reason || "FACE_NOT_VISIBLE",
      detectionCount: Number(visitCount) || 1,
      firstDetectedAt: capturedAt,
      lastDetectedAt: capturedAt,
      camera,
      direction,
      scans: [{ timestamp: capturedAt, photoUrl: null, camera, direction, framePath: paths.framePath || null, bodyPath: paths.bodyPath || null }],
      ...metadata,
    });
    return createRepo({
      photoUrl: null,
      facePassportPath: null,
      faceAlignedPath: paths.faceAlignedPath || null,
      bodyPath: paths.bodyPath || null,
      faceQualityScore: paths.faceQualityScore ?? null,
      faceReason: paths.faceReason || metadata.face_reason || "FACE_NOT_VISIBLE",
      personName: "Face not captured",
      personType: "NO_FACE_CAPTURED",
      status: "UNREGISTERED",
      embedding: null,
      employeeId: null,
      notes,
    });
  }

  if (!imageFilename) {
    const error = new Error("face_passport_path is required for unknown face capture");
    error.statusCode = 400;
    throw error;
  }

  // If embedding was not passed directly, extract from image
  if (!liveEmbedding || !Array.isArray(liveEmbedding) || liveEmbedding.length === 0) {
    liveEmbedding = await extractEmbeddingFromImage(imageFilename);
  }

  // 1. STRICT GUARD: If this face matches ANY registered employee, NEVER add to unknown list!
  // Use the same threshold as live recognition before excluding a captured face.
  if (liveEmbedding && Array.isArray(liveEmbedding) && liveEmbedding.length > 0) {
    const registeredVectors = await getAllRegisteredEmployeeVectors();
    for (const ref of registeredVectors) {
      const sim = computeCosineSimilarity(liveEmbedding, ref.embedding);
      if (sim >= UNKNOWN_EMPLOYEE_MATCH_THRESHOLD) {
        const empCode = ref.employeeCode || 'registered';
        console.log(`[FaceService] Ignored unknown capture: person matches registered employee ${empCode} (Similarity: ${sim.toFixed(4)} >= ${UNKNOWN_EMPLOYEE_MATCH_THRESHOLD}). Excluded from unknown list.`);
        
        // Remove file from disk since it belongs to a registered employee
        const filePath = resolveMediaPath(imageFilename);
        if (filePath && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }

        return {
          id: null,
          status: "REGISTERED_EMPLOYEE",
          message: `Person matches registered employee ${empCode}. Ignored from unknown list.`,
          employeeId: ref.employeeId || null,
        };
      }
    }
  }

  // Fetch all existing unregistered/unassigned unknown faces
  const allUnknownFaces = await findUnknownFaceEnrollments();

  let matchedFace = null;
  let bestSimilarity = -1;
  const MATCH_THRESHOLD = 0.48; // ArcFace threshold for same person verification

  if (liveEmbedding && Array.isArray(liveEmbedding) && liveEmbedding.length > 0) {
    for (const record of allUnknownFaces) {
      let storedEmb = record.embedding;
      if ((!storedEmb || !Array.isArray(storedEmb) || storedEmb.length === 0) && (record.facePassportPath || record.photoUrl)) {
        // Try extracting embedding on-the-fly for legacy record if missing
        storedEmb = await extractEmbeddingFromImage(record.facePassportPath || record.photoUrl);
        if (storedEmb) {
          await updateRepo(record, { embedding: storedEmb });
          record.embedding = storedEmb;
        }
      }

      if (storedEmb && Array.isArray(storedEmb) && storedEmb.length > 0) {
        const sim = computeCosineSimilarity(liveEmbedding, storedEmb);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          if (sim >= MATCH_THRESHOLD) {
            matchedFace = record;
          }
        }
      }
    }
  }

  if (matchedFace) {
    // Matched existing unknown visitor!
    console.log(`[FaceService] Matched visitor: ${matchedFace.personName || matchedFace.id} (Similarity: ${bestSimilarity.toFixed(4)})`);
    let notesData = {};
    if (matchedFace.notes) {
      try {
        notesData = typeof matchedFace.notes === 'string' ? JSON.parse(matchedFace.notes) : matchedFace.notes;
      } catch {
        notesData = { legacy: matchedFace.notes };
      }
    }

    const camName = metadata.camera || (imageFilename.includes('CAM-02') ? 'CAM-02 (IN)' : 'CAM-01 (OUT)');
    const isIN = camName.includes('CAM-02') || camName.includes('IN') || metadata.direction === 'IN';
    const direction = isIN ? 'IN' : 'OUT';

    const lastDetected = notesData.lastDetectedAt ? new Date(notesData.lastDetectedAt).getTime() : 0;
    const isSameActiveSession = (Date.now() - lastDetected) < 45000; // 45-second visit session debounce

    const currentCount = isSameActiveSession
      ? Math.max(Number(notesData.detectionCount || 1), 1)
      : Math.max(Number(notesData.detectionCount || 1) + 1, Number(visitCount || 1));

    notesData.detectionCount = currentCount;
    if (!isSameActiveSession) {
      notesData.inCount = (Number(notesData.inCount) || 0) + (isIN ? 1 : 0);
      notesData.outCount = (Number(notesData.outCount) || 0) + (!isIN ? 1 : 0);
    }
    notesData.isFrequentUnknown = currentCount > 3;
    notesData.lastDetectedAt = new Date().toISOString();

    const scans = Array.isArray(notesData.scans) ? notesData.scans : [];
    scans.unshift({
      timestamp: new Date().toISOString(),
      photoUrl: imageFilename,
      camera: camName,
      location: metadata.location || "Main Gate",
      direction: direction,
    });
    // Keep up to 100 recent scans
    notesData.scans = scans.slice(0, 100);

    await updateRepo(matchedFace, {
      photoUrl: imageFilename, // latest face photo
      facePassportPath: imageFilename,
      faceAlignedPath: paths.faceAlignedPath || matchedFace.faceAlignedPath || null,
      bodyPath: paths.bodyPath || matchedFace.bodyPath || null,
      faceQualityScore: paths.faceQualityScore ?? matchedFace.faceQualityScore ?? null,
      faceReason: paths.faceReason || null,
      notes: JSON.stringify(notesData),
      // If the record didn't have embedding saved, save the latest one
      ...(matchedFace.embedding ? {} : { embedding: liveEmbedding })
    });

    return matchedFace;
  }

  // BRAND NEW UNKNOWN VISITOR (e.g. Visitor #1, Visitor #2...)
  const nextNum = allUnknownFaces.length + 1;
  const personName = `Visitor #${nextNum}`;
  console.log(`[FaceService] Creating new unregistered record: ${personName} with 512-D embedding`);

  const camName = metadata.camera || (imageFilename.includes('CAM-02') ? 'CAM-02 (IN)' : 'CAM-01 (OUT)');
  const isIN = camName.includes('CAM-02') || camName.includes('IN') || metadata.direction === 'IN';
  const direction = isIN ? 'IN' : 'OUT';

  const initialCount = Number(visitCount || 1);
  const notesPayload = JSON.stringify({
    personName,
    detectionCount: initialCount,
    inCount: isIN ? 1 : 0,
    outCount: !isIN ? 1 : 0,
    isFrequentUnknown: initialCount > 3,
    lastDetectedAt: new Date().toISOString(),
    firstDetectedAt: new Date().toISOString(),
    scans: [
      {
        timestamp: new Date().toISOString(),
        photoUrl: imageFilename,
        camera: camName,
        location: metadata.location || "Main Gate",
        direction: direction,
      }
    ],
    ...metadata
  });

  const record = await createRepo({
    photoUrl: imageFilename,
    facePassportPath: imageFilename,
    faceAlignedPath: paths.faceAlignedPath || null,
    bodyPath: paths.bodyPath || null,
    faceQualityScore: paths.faceQualityScore ?? null,
    faceReason: paths.faceReason || null,
    personName: personName,
    status: "UNREGISTERED",
    embedding: liveEmbedding || null,
    employeeId: null,
    notes: notesPayload
  });

  return record;
};


export const getAllUnknownFaces = async () => {
  const records = await findUnknownFaceEnrollments();
  const registeredVectors = await getAllRegisteredEmployeeVectors();
  const unknownDir = path.join(AI_SERVICES_DIR, 'data', 'unknown');

  // 1. Filter out records that match the live recognition threshold.
  const validUnknowns = [];
  for (const record of records) {
    // If assigned to an employee, skip and exclude
    if (record.employeeId || record.status === 'ASSIGNED' || record.status === 'REGISTERED_EMPLOYEE') {
      continue;
    }

    let recNotes = {};
    if (record.notes) {
      try {
        recNotes = typeof record.notes === 'string' ? JSON.parse(record.notes) : record.notes;
      } catch {}
    }
    if (recNotes.faceStatus === "NO_FACE_CAPTURED") {
      validUnknowns.push(record);
      continue;
    }

    let recEmb = record.embedding;
    if ((!recEmb || !Array.isArray(recEmb) || recEmb.length === 0) && (record.facePassportPath || record.photoUrl)) {
      recEmb = await extractEmbeddingFromImage(record.facePassportPath || record.photoUrl);
      if (recEmb) {
        await updateRepo(record, { embedding: recEmb });
        record.embedding = recEmb;
      }
    }

    let isEmployeeMatch = false;
    let matchedEmp = '';
    let matchSim = 0;

    if (recEmb && Array.isArray(recEmb) && recEmb.length > 0 && registeredVectors.length > 0) {
      for (const ref of registeredVectors) {
        const sim = computeCosineSimilarity(recEmb, ref.embedding);
        if (sim >= UNKNOWN_EMPLOYEE_MATCH_THRESHOLD) {
          isEmployeeMatch = true;
          matchedEmp = ref.employeeCode || 'registered';
          matchSim = sim;
          break;
        }
      }
    }

    if (isEmployeeMatch) {
      console.log(`[FaceService] Removing unrecognized face record ${record.id} - matches registered employee ${matchedEmp} (Sim: ${matchSim.toFixed(4)})`);
      await deleteRepo(record);
      if (record.facePassportPath || record.photoUrl) {
        const filePath = resolveMediaPath(record.facePassportPath || record.photoUrl);
        if (filePath && fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch {}
        }
      }
    } else {
      validUnknowns.push(record);
    }
  }

  // 2. DEDUPLICATE & CLUSTER: Ensure each unique person appears only ONCE
  const clusteredPersons = [];
  for (const rec of validUnknowns) {
    let recNotes = {};
    if (rec.notes) {
      try {
        recNotes = typeof rec.notes === 'string' ? JSON.parse(rec.notes) : rec.notes;
      } catch {}
    }

    let matchedCluster = null;
    let bestSim = 0;
    if (rec.embedding && Array.isArray(rec.embedding) && rec.embedding.length === 512) {
      for (const c of clusteredPersons) {
        if (c.embedding && Array.isArray(c.embedding)) {
          const sim = computeCosineSimilarity(rec.embedding, c.embedding);
          if (sim > bestSim) {
            bestSim = sim;
            if (sim >= 0.45) {
              matchedCluster = c;
            }
          }
        }
      }
    }

    // Determine camera direction for this record
    const photo = rec.photoUrl || '';
    const cam = (rec.camera && rec.camera.name) || recNotes.camera || (photo.includes('CAM-02') ? 'CAM-02 (IN)' : 'CAM-01 (OUT)');
    const isIN = cam.includes('02') || cam.includes('IN');
    const direction = isIN ? 'IN' : 'OUT';

    const rawScans = Array.isArray(recNotes.scans) && recNotes.scans.length > 0
      ? recNotes.scans
      : [{
          timestamp: rec.createdAt,
          photoUrl: photo,
          camera: cam,
          location: (rec.camera && rec.camera.location) || recNotes.location || 'Main Gate',
          direction: direction
        }];

    if (matchedCluster) {
      // Merge into existing cluster!
      // Add all scans
      const existingTimestamps = new Set(matchedCluster.allScans.map(s => s.timestamp));
      for (const s of rawScans) {
        const sDir = s.direction || ((s.camera && (s.camera.includes('02') || s.camera.includes('IN'))) ? 'IN' : 'OUT');
        if (!existingTimestamps.has(s.timestamp)) {
          matchedCluster.allScans.push({ ...s, direction: sDir });
          existingTimestamps.add(s.timestamp);
          if (sDir === 'IN') matchedCluster.inCount++;
          else matchedCluster.outCount++;
        }
      }
      matchedCluster.detectionCount = matchedCluster.allScans.length;
      matchedCluster.allScans.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      // Delete redundant duplicate record from DB asynchronously
      deleteRepo(rec).catch(() => {});
    } else {
      let inCount = Number(recNotes.inCount) || 0;
      let outCount = Number(recNotes.outCount) || 0;
      if (inCount === 0 && outCount === 0) {
        for (const s of rawScans) {
          const sDir = s.direction || ((s.camera && (s.camera.includes('02') || s.camera.includes('IN'))) ? 'IN' : 'OUT');
          if (sDir === 'IN') inCount++;
          else outCount++;
        }
      }

      const normalizedScans = rawScans.map(s => ({
        ...s,
        direction: s.direction || ((s.camera && (s.camera.includes('02') || s.camera.includes('IN'))) ? 'IN' : 'OUT')
      })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Prepare clean cluster object
      const plain = rec.toJSON ? rec.toJSON() : { ...rec };
      plain.inCount = inCount;
      plain.outCount = outCount;
      plain.detectionCount = Math.max(Number(recNotes.detectionCount || 1), inCount + outCount, normalizedScans.length);
      plain.allScans = normalizedScans;
      plain.firstDetectedAt = recNotes.firstDetectedAt || (normalizedScans[normalizedScans.length - 1]?.timestamp) || rec.createdAt;
      plain.lastDetectedAt = recNotes.lastDetectedAt || (normalizedScans[0]?.timestamp) || rec.createdAt;

      clusteredPersons.push(plain);
    }
  }

  return clusteredPersons;
};

export const assignUnknownFace = async (id, employeeId) => {
  const enrollment = await findFaceEnrollmentById(id);
  if (!enrollment) {
    const error = new Error("Face enrollment not found");
    error.statusCode = 404;
    throw error;
  }
  
  if (enrollment.status === "ASSIGNED") {
    const error = new Error("This face is already assigned");
    error.statusCode = 400;
    throw error;
  }

  const employee = await getEmployeeById(employeeId);
  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  return updateRepo(enrollment, {
    employeeId,
    status: "ASSIGNED"
  });
};

export const registerUnknownFace = async (id, data) => {
  const enrollment = await findFaceEnrollmentById(id);
  if (!enrollment) {
    const error = new Error("Record not found");
    error.statusCode = 404;
    throw error;
  }

  const now = new Date();
  const passIssuedAt = now.toISOString();

  let existingNotes = {};
  if (enrollment.notes) {
    try {
      existingNotes = JSON.parse(enrollment.notes);
    } catch {
      existingNotes = { legacy: enrollment.notes };
    }
  }

  let incomingNotes = {};
  if (data.notes) {
    try {
      incomingNotes = typeof data.notes === "string" ? JSON.parse(data.notes) : data.notes;
    } catch {
      incomingNotes = { text: data.notes };
    }
  }

  const targetDate = data.entryDate || incomingNotes.date || enrollment.entryDate || now.toISOString().split("T")[0];
  const targetInTime = data.inTime || incomingNotes.inTime || enrollment.inTime || `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const targetOutTime = data.outTime || incomingNotes.outTime || enrollment.outTime || null;

  let computedExpiresAt = null;
  if (targetDate && targetOutTime) {
    const timeWithSec = targetOutTime.length === 5 ? `${targetOutTime}:00` : targetOutTime;
    const inTimeWithSec = targetInTime.length === 5 ? `${targetInTime}:00` : targetInTime;
    const inDateObj = new Date(`${targetDate}T${inTimeWithSec}`);
    const outDateObj = new Date(`${targetDate}T${timeWithSec}`);
    if (!isNaN(outDateObj.getTime())) {
      if (!isNaN(inDateObj.getTime()) && outDateObj <= inDateObj) {
        const nextDay = new Date(outDateObj.getTime() + 24 * 60 * 60 * 1000);
        computedExpiresAt = nextDay.toISOString();
      } else {
        computedExpiresAt = outDateObj.toISOString();
      }
    }
  }

  const finalExpiresAt = incomingNotes.passExpiresAt || computedExpiresAt || existingNotes.passExpiresAt || new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

  const mergedNotes = JSON.stringify({
    ...existingNotes,
    ...incomingNotes,
    visitor: data.personName || enrollment.personName,
    process: data.reason || enrollment.reason,
    date: targetDate,
    inTime: targetInTime,
    outTime: targetOutTime,
    passIssuedAt: incomingNotes.passIssuedAt || existingNotes.passIssuedAt || passIssuedAt,
    passExpiresAt: finalExpiresAt,
    validityStatus: new Date(finalExpiresAt).getTime() > Date.now() ? "VALID" : "EXPIRED",
  });

  return updateRepo(enrollment, {
    personName: data.personName,
    entryDate: targetDate,
    inTime: targetInTime,
    outTime: targetOutTime,
    reason: data.reason,
    personType: data.personType || "Visitor",
    companyName: data.companyName || null,
    notes: mergedNotes,
    status: data.status ? data.status : (data.isCheckout ? "COMPLETED" : "REGISTERED")
  });
};
