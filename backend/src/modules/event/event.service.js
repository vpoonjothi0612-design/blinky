import { Op, col, fn, where as sequelizeWhere } from "sequelize";
import fs from "fs/promises";
import path from "path";
import SurveillanceEvent from "./event.model.js";
import Employee from "../employee/employee.model.js";
import FaceEnrollment from "../face-enrollment/face-enrollment.model.js";
import Camera from "../camera/camera.model.js";
import Vehicle from "../vehicle/vehicle.model.js";
import { broadcastLiveEvent, createAttendance } from "../attendance/attendance.service.js";
import { MEDIA_ROOT, mediaUrl, normalizeMediaPath, resolveMediaPath } from "../media/media.service.js";
import { mapViewMetadata } from "./view-metadata.js";

const INDIAN_PLATE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;
const INDIAN_STATE_CODES = new Set("AP AR AS BR CG CH DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD PB PY RJ SK TN TR TS UK UP WB".split(" "));
const BH_PLATE = /^\d{2}BH\d{4}[A-Z]{1,2}$/;
const OCR_TO_DIGIT = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };
const OCR_TO_LETTER = { "0": "O", "1": "I", "2": "Z", "5": "S", "8": "B" };
const recentVehicleTracks = new Map();
const eventCountCache = new Map();
const normalizeRegistryPlate = (plate) => String(plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const formatRegisteredVehicle = (vehicle) => {
  const raw = vehicle.toJSON ? vehicle.toJSON() : vehicle;
  const employee = raw.employee;
  return {
    registration_number: raw.registrationNumber,
    type: raw.type,
    make: raw.make,
    model: raw.model,
    color: raw.color,
    owner: employee
      ? {
          employee_code: employee.employeeCode,
          name: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
        }
      : null,
  };
};

const findRegisteredVehiclesByPlates = async (plateTexts = []) => {
  const normalizedPlates = [...new Set(plateTexts.map(normalizeRegistryPlate).filter(Boolean))];
  if (!normalizedPlates.length) return new Map();

  const records = await Vehicle.findAll({
    where: {
      status: "ACTIVE",
      [Op.and]: sequelizeWhere(
        fn("regexp_replace", fn("upper", col("registration_number")), "[^A-Z0-9]", "", "g"),
        { [Op.in]: normalizedPlates },
      ),
    },
    attributes: ["registrationNumber", "type", "make", "model", "color"],
    include: [{
      model: Employee,
      as: "employee",
      attributes: ["employeeCode", "firstName", "lastName"],
      required: false,
    }],
  });

  const matches = new Map();
  for (const vehicle of records) {
    const key = normalizeRegistryPlate(vehicle.registrationNumber);
    if (matches.has(key)) {
      matches.set(key, null);
    } else {
      matches.set(key, formatRegisteredVehicle(vehicle));
    }
  }
  return matches;
};

export const canonicalActiveEventCameraIds = (cameraNames = []) => Array.from(new Set(
  cameraNames
    .map((name) => String(name || "").match(/CAM[-_ ]?0[12]/i)?.[0]?.replace(/[ _]/g, "-").toUpperCase())
    .filter(Boolean)
));

// Format date to ISO string with IST (+05:30) offset
export const formatToIstString = (dateInput = new Date()) => {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return new Date().toISOString();
  
  // IST is UTC + 5:30
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(d.getTime() + istOffsetMs);
  const isoUtc = istDate.toISOString(); // e.g. 2026-11-14T15:20:00.000Z
  return isoUtc.replace("Z", "+05:30");
};

export const resolveImageUrl = (filename, defaultFolder = "captured-images") => {
  if (!filename) return null;
  if (filename.startsWith("http://") || filename.startsWith("https://")) {
    return filename;
  }
  const folder = {
    "captured-images": "captures",
    "unknown-images": "unknown",
    "snapshot-images": "snapshots",
    "vehicle-images": "vehicle",
    "animal-images": "animal",
    "enrollment-images": "enrollment",
  }[defaultFolder] || "captures";
  const relative = normalizeMediaPath(filename, folder);
  return mediaUrl(relative);
};

export const recordSurveillanceEvent = async (data) => {
  const istTimestamp = data.timestamp || formatToIstString();
  const cameraId = data.cameraId || data.camera_id || "CAM-02";
  const direction = data.direction || (cameraId.includes("01") ? "OUT" : "IN");
  const eventType = data.eventType || data.event_type || "PERSON_UNKNOWN_IN";
  const trackId = data.trackId ?? data.track_id;
  const incomingPlateStatus = normalizePlateStatus(data.plateStatus || data.plate_status);
  const rawPlateCandidate = data.plateText || data.plate_text || data.rawPlateText || data.raw_plate_text;
  const plateText = normalizeValidPlate(rawPlateCandidate)
    || (incomingPlateStatus === "invalid_format" ? String(rawPlateCandidate || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 50) || null : null);
  
  // Find employee if employeeCode or employeeId passed
  let emp = null;
  if (data.employeeId || data.employeeCode) {
    const employeeIdentifier = String(data.employeeId || "");
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeIdentifier);
    emp = await Employee.findOne({
      // The camera registry uses employeeCode (e.g. EMP042), while the SQL
      // employee primary key is a UUID. Never cast a code to the UUID column.
      where: isUuid
        ? { id: employeeIdentifier }
        : { employeeCode: data.employeeCode || employeeIdentifier },
      include: [
        {
          model: FaceEnrollment,
          as: "faceEnrollment",
          attributes: ["photoUrl", "images"],
          required: false,
        },
      ],
    });
  }

  const nameIsRawPlate = [data.plateText, data.rawPlateText]
    .some((value) => value && String(value).toUpperCase() === String(data.name || "").toUpperCase());
  const employeeName = emp
    ? `${emp.firstName || ""} ${emp.lastName || ""}`.trim()
    : nameIsRawPlate && plateText
      ? plateText
      : data.name || (eventType.startsWith("ANIMAL") ? (data.species || "Animal") : (plateText || "Unknown"));

  const department = emp ? emp.department : data.department || null;
  const designation = emp ? emp.designation : data.designation || null;
  const employeeId = emp ? emp.id : data.employeeId || null;
  const employeeCode = emp ? emp.employeeCode : data.employeeCode || null;

  // Determine alarm status based on event type
  // PERSON_UNKNOWN raises alarm, animals and vehicles do not
  const isAlarm = data.alarm !== undefined
    ? Boolean(data.alarm)
    : eventType.includes("UNKNOWN");

  const eventPayload = {
    cameraId,
    cameraName: data.cameraName || (cameraId.includes("01") ? "CAM-01 (Exit Gate • OUT)" : "CAM-02 (Entry Gate • IN)"),
    direction,
    eventType,
    timestamp: istTimestamp,
    employeeId,
    employeeCode,
    name: employeeName,
    department,
    designation,
    matchScore: data.matchScore !== undefined ? Number(data.matchScore) : (data.similarity !== undefined ? Number(data.similarity) : null),
    plateText,
    rawPlateText: data.rawPlateText || null,
    plateStatus: resolvePlateStatus(
      plateText,
      data.plateConfidence,
      incomingPlateStatus,
      data.rawPlateText || data.raw_plate_text,
    ),
    plateConfidence: data.plateConfidence == null ? null : Number(data.plateConfidence),
    vehicleType: data.vehicleType || data.vehicle_type || null,
    gateName: data.gateName || data.cameraName || null,
    detectedAt: new Date(istTimestamp),
    mergedFrameCount: 1,
    vehicleImagePath: data.vehicleImagePath || data.imageFrame || null,
    plateImagePath: data.plateImagePath || data.imagePlate || null,
    species: data.species || null,
    imageFace: data.imageFace || data.capturedImage || null,
    imagePlate: data.imagePlate || null,
    imageFrame: data.imageFrame || null,
    alarm: isAlarm,
    metadata: { ...(data.metadata || {}), ...(trackId != null ? { trackId: String(trackId) } : {}), ...(data.imageFrame ? { frames: [data.imageFrame] } : {}) },
  };

  const dedupeKey = eventType.startsWith("VEHICLE") && trackId != null ? `${cameraId}:${trackId}` : null;
  const prior = dedupeKey && recentVehicleTracks.get(dedupeKey);
  let created;
  if (prior && Date.now() - prior.seenAt <= 30000) {
    const existing = await SurveillanceEvent.findByPk(prior.id);
    if (existing) {
      // A delayed blank event for the same track must not erase a plate read
      // successfully from another camera frame.
      if (existing.plateText && !eventPayload.plateText) {
        eventPayload.plateText = existing.plateText;
        eventPayload.rawPlateText = existing.rawPlateText;
        eventPayload.plateStatus = existing.plateStatus;
        eventPayload.plateConfidence = existing.plateConfidence;
        eventPayload.plateImagePath = existing.plateImagePath;
        eventPayload.imagePlate = existing.imagePlate;
      }
      const earliest = new Date(existing.detectedAt || existing.timestamp) <= new Date(istTimestamp) ? existing.detectedAt || existing.timestamp : istTimestamp;
      const frames = [...new Set([...(existing.metadata?.frames || []), ...(eventPayload.metadata?.frames || [])])];
      await existing.update({ ...eventPayload, metadata: { ...(existing.metadata || {}), ...(eventPayload.metadata || {}), frames }, timestamp: String(earliest), detectedAt: new Date(earliest), mergedFrameCount: Number(existing.mergedFrameCount || 1) + 1 });
      created = existing;
    }
  }
  if (!created) created = await SurveillanceEvent.create(eventPayload);
  if (dedupeKey) recentVehicleTracks.set(dedupeKey, { id: created.id, seenAt: Date.now() });

  // If this is a recognized employee gate punch (PERSON_IN / PERSON_OUT), record attendance
  if ((eventType === "PERSON_IN" || eventType === "PERSON_OUT") && emp) {
    try {
      await createAttendance({
        employeeId: emp.id,
        cameraId: null, // Let attendance service match or accept
        eventType: direction,
        similarity: eventPayload.matchScore || 0.95,
        eventId: created.id,
        status: "PRESENT",
        source: "AI_CAMERA",
        capturedImage: eventPayload.imageFace,
      });
    } catch (attErr) {
      console.warn("[SurveillanceEvent] Sync to attendance notice:", attErr.message);
    }
  }

  // Format response for real-time SSE broadcast
  const registeredVehicles = eventPayload.plateStatus === "recognized"
    ? await findRegisteredVehiclesByPlates([eventPayload.plateText])
    : new Map();
  const formattedEvent = formatEventResponse(
    created,
    registeredVehicles.get(normalizeRegistryPlate(eventPayload.plateText)) || null,
  );

  // Broadcast to all active frontend SSE streams
  broadcastLiveEvent({
    type: "GATE_EVENT",
    ...formattedEvent,
  });

  return formattedEvent;
};

export const getSurveillanceEvents = async (query = {}) => {
  const where = {};

  if (query.type) {
    const rawType = query.type.toUpperCase().trim();
    if (rawType === "VEHICLE" || rawType === "VEHICLES") {
      where.eventType = { [Op.in]: ["VEHICLE_IN", "VEHICLE_OUT"] };
    } else if (rawType === "PERSON" || rawType === "PERSONS") {
      where.eventType = { [Op.in]: ["PERSON_IN", "PERSON_OUT", "PERSON_UNKNOWN_IN", "PERSON_UNKNOWN_OUT", "PERSON_NO_FACE", "NO_FACE_CAPTURED"] };
    } else if (rawType === "ANIMAL" || rawType === "ANIMALS") {
      where.eventType = "ANIMAL_DETECTED";
    } else if (rawType.includes(",")) {
      where.eventType = { [Op.in]: rawType.split(",").map((t) => t.trim()) };
    } else {
      where.eventType = query.type;
    }
  }

  if (query.camera) where.cameraId = { [Op.iLike]: `%${query.camera}%` };
  if (query.search) where[Op.and] = [...(where[Op.and] || []), { [Op.or]: [
    { cameraId: { [Op.iLike]: `%${query.search}%` } },
    { cameraName: { [Op.iLike]: `%${query.search}%` } },
    { plateText: { [Op.iLike]: `%${query.search}%` } },
    { vehicleType: { [Op.iLike]: `%${query.search}%` } },
  ] }];

  if (query.direction) {
    where.direction = query.direction.toUpperCase();
  }

  if (query.since) {
    where.createdAt = { [Op.gte]: new Date(query.since) };
  }
  // surveillance_events stores the worker's canonical camera IDs (CAM-01/02),
  // while camera records may use decorated labels such as "CAM-02 (Entry)".
  // Filtering by the full display label silently removed every live event.
  const activeCameraNames = (await Camera.findAll({ where: { status: "ACTIVE" }, attributes: ["name"], raw: true })).map((camera) => camera.name);
  const activeEventCameraIds = canonicalActiveEventCameraIds(activeCameraNames);
  if (activeEventCameraIds.length) {
    where.cameraId = { ...(typeof where.cameraId === "object" ? where.cameraId : {}), [Op.in]: activeEventCameraIds };
  }

  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
  const sortField = ({ timestamp: "timestamp", direction: "direction", gate: "cameraName", status: "plateText" })[query.sort] || "timestamp";
  const sortDirection = String(query.order).toUpperCase() === "ASC" ? "ASC" : "DESC";
  const baseWhere = { ...where };
  if (query.tab === "ENTRY") baseWhere.direction = "IN";
  if (query.tab === "EXIT") baseWhere.direction = "OUT";
  if (query.tab === "RECOGNIZED") baseWhere.plateStatus = "recognized";
  if (query.tab === "NOT_RECOGNIZED") baseWhere[Op.or] = [
    { plateStatus: { [Op.in]: ["low_confidence", "not_recognized", "invalid_format"] } },
    { plateStatus: null },
  ];
  const countWhere = { ...where };
  const countKey = JSON.stringify(query, Object.keys(query).sort());
  let cached = eventCountCache.get(countKey);
  if (!cached || Date.now() - cached.at > 5000) {
    cached = { at: Date.now(), value: Promise.all([
      SurveillanceEvent.count({ where: countWhere }),
      SurveillanceEvent.count({ where: { ...countWhere, direction: "IN" } }),
      SurveillanceEvent.count({ where: { ...countWhere, direction: "OUT" } }),
      SurveillanceEvent.count({ where: { ...countWhere, plateStatus: "recognized" } }),
      SurveillanceEvent.count({ where: { ...countWhere, [Op.or]: [
        { plateStatus: { [Op.in]: ["low_confidence", "not_recognized", "invalid_format"] } },
        { plateStatus: null },
      ] } }),
    ]) };
    eventCountCache.set(countKey, cached);
  }
  const [allCount, entryCount, exitCount, plateCount, notReadCount] = await cached.value;

  const events = await SurveillanceEvent.findAll({
    where: baseWhere,
    order: [[sortField, sortDirection]],
    limit,
    offset: (page - 1) * limit,
    include: [
      {
        model: Employee,
        as: "employee",
        attributes: ["id", "employeeCode", "firstName", "lastName", "department", "designation"],
        include: [
          {
            model: FaceEnrollment,
            as: "faceEnrollment",
            attributes: ["photoUrl", "images"],
            required: false,
          },
        ],
      },
    ].filter(() => !["VEHICLE", "VEHICLES"].includes(String(query.type || "").toUpperCase())),
  });

  const registeredVehicles = await findRegisteredVehiclesByPlates(
    events.filter((event) => event.plateStatus === "recognized").map((event) => event.plateText),
  );
  return {
    rows: events.map((event) => formatEventResponse(
      event,
      registeredVehicles.get(normalizeRegistryPlate(event.plateText)) || null,
    )),
    page,
    limit,
    total: await SurveillanceEvent.count({ where: baseWhere }),
    counts: { all: allCount, entry: entryCount, exit: exitCount, recognized: plateCount, notRecognized: notReadCount },
  };
};

export const getSurveillanceEventById = async (id) => {
  const event = await SurveillanceEvent.findByPk(id);
  if (!event) return null;
  const registeredVehicles = event.plateStatus === "recognized"
    ? await findRegisteredVehiclesByPlates([event.plateText])
    : new Map();
  return formatEventResponse(
    event,
    registeredVehicles.get(normalizeRegistryPlate(event.plateText)) || null,
  );
};

export const correctSurveillanceEventPlate = async (id, submittedPlate) => {
  const normalizedSubmitted = String(submittedPlate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const plateText = normalizeValidPlate(normalizedSubmitted) || (BH_PLATE.test(normalizedSubmitted) ? normalizedSubmitted : null);
  if (!plateText || (!BH_PLATE.test(plateText) && !INDIAN_STATE_CODES.has(plateText.slice(0, 2)))) {
    const error = new Error("Enter a valid Indian vehicle registration number.");
    error.statusCode = 400;
    throw error;
  }
  const event = await SurveillanceEvent.findByPk(id);
  if (!event) return null;
  if (!String(event.eventType || "").startsWith("VEHICLE")) {
    const error = new Error("Plate correction is only available for vehicle events.");
    error.statusCode = 400;
    throw error;
  }

  const existingCrop = resolveMediaPath(event.imagePlate || event.plateImagePath);
  if (!existingCrop) {
    const error = new Error("This event has no saved plate crop to attach to the correction.");
    error.statusCode = 400;
    throw error;
  }
  try {
    await fs.access(existingCrop);
  } catch {
    const error = new Error("The saved plate crop is missing from the media folder.");
    error.statusCode = 400;
    throw error;
  }
  const correctedAt = new Date().toISOString();
  const baseName = `${String(event.id).replace(/[^A-Za-z0-9-]/g, "")}_${plateText}_${Date.now()}`;
  const relativeCropPath = path.posix.join("corrections", `${baseName}.jpg`);
  const correctionDirectory = path.join(MEDIA_ROOT, "corrections");
  await fs.mkdir(correctionDirectory, { recursive: true });
  const correctionCropPath = path.join(correctionDirectory, `${baseName}.jpg`);
  await fs.copyFile(existingCrop, correctionCropPath);
  await fs.writeFile(
    path.join(correctionDirectory, `${baseName}.json`),
    JSON.stringify({ event_id: event.id, corrected_plate: plateText, crop: relativeCropPath, corrected_at: correctedAt }, null, 2),
    "utf8",
  );

  await event.update({
    plateText,
    rawPlateText: plateText,
    plateStatus: "recognized",
    plateConfidence: 1,
    metadata: {
      ...(event.metadata || {}),
      plateCorrection: { correctedPlate: plateText, crop: relativeCropPath, correctedAt },
    },
  });
  const registeredVehicles = await findRegisteredVehiclesByPlates([plateText]);
  return formatEventResponse(
    event,
    registeredVehicles.get(normalizeRegistryPlate(plateText)) || null,
  );
};

export const formatEventResponse = (event, registeredVehicle = null) => {
  const raw = event.toJSON ? event.toJSON() : event;

  // Resolve image URLs with cache-busting timestamp support
  const imageFaceUrl = raw.imageFace
    ? resolveImageUrl(raw.imageFace, raw.imageFace.startsWith("unknown_") ? "unknown-images" : "captured-images")
    : null;

  const imagePlateUrl = raw.imagePlate
    ? resolveImageUrl(raw.imagePlate, "vehicle-images")
    : null;

  const imageFrameUrl = raw.imageFrame
    ? resolveImageUrl(raw.imageFrame, "snapshot-images")
    : null;

  const empPhoto = raw.employee?.faceEnrollment?.photoUrl;
  const profileImageUrl = empPhoto
    ? resolveImageUrl(empPhoto, "captured-images")
    : (imageFaceUrl || null);

  const isPersonRegistered = (raw.eventType === "PERSON_IN" || raw.eventType === "PERSON_OUT" || Boolean(raw.employeeId || (raw.employeeCode && raw.employeeCode !== "UNKNOWN")));
  const isPersonUnregistered = Boolean(raw.eventType && raw.eventType.startsWith("PERSON") && !isPersonRegistered);
  const personStatus = isPersonRegistered ? "REGISTERED" : (isPersonUnregistered ? "UNREGISTERED" : null);

  return {
    id: raw.id,
    camera_id: raw.cameraId,
    direction: raw.direction,
    event_type: raw.eventType,
    timestamp: raw.timestamp || formatToIstString(raw.createdAt),
    employee_id: raw.employeeId,
    employee_code: raw.employeeCode,
    name: raw.name || "Unknown",
    department: raw.department || null,
    designation: raw.designation || null,
    match_score: raw.matchScore,
    plate_text: raw.plateText,
    raw_plate_text: raw.rawPlateText,
    plate_status: raw.plateStatus,
    plate_confidence: raw.plateConfidence,
    vehicle_type: raw.vehicleType || raw.metadata?.vehicleType || null,
    gate_name: raw.gateName || raw.cameraName,
    detected_at: raw.detectedAt || raw.timestamp,
    merged_frame_count: raw.mergedFrameCount || 1,
    all_photos: raw.metadata?.frames || [],
    vehicle_image_url: raw.vehicleImagePath ? resolveImageUrl(raw.vehicleImagePath, "snapshot-images") : imageFrameUrl,
    plate_image_url: raw.plateImagePath ? resolveImageUrl(raw.plateImagePath, "vehicle-images") : imagePlateUrl,
    registered_vehicle: raw.plateStatus === "recognized" ? registeredVehicle : null,
    species: raw.species,
    image_face_url: imageFaceUrl,
    image_plate_url: imagePlateUrl,
    image_frame_url: imageFrameUrl,
    profile_image_url: profileImageUrl,
    person_status: personStatus,
    ...mapViewMetadata(raw.metadata || {}),
    alarm: Boolean(raw.alarm),
    created_at: raw.createdAt,
  };
};

const normalizeValidPlate = (text) => {
  const normalized = String(text || "").toUpperCase().replace(/[\s.-]/g, "");
  if (INDIAN_PLATE.test(normalized)) return normalized;

  // OCR commonly reads zero as O (for example TNO9CH3787). Correct only
  // characters in their expected numeric/letter positions, and only keep the
  // result when it matches the complete Indian registration format.
  for (const registrationDigits of [2, 1]) {
    for (const seriesLetters of [3, 2, 1, 0]) {
      if (normalized.length !== 2 + registrationDigits + seriesLetters + 4) continue;

      const state = normalized.slice(0, 2);
      const codeStart = 2;
      const seriesStart = codeStart + registrationDigits;
      const numberStart = seriesStart + seriesLetters;
      const registrationCode = normalized.slice(codeStart, seriesStart)
        .replace(/[OQDILZSBG]/g, (char) => OCR_TO_DIGIT[char]);
      const series = normalized.slice(seriesStart, numberStart)
        .replace(/[01258]/g, (char) => OCR_TO_LETTER[char]);
      const number = normalized.slice(numberStart)
        .replace(/[OQDILZSBG]/g, (char) => OCR_TO_DIGIT[char]);
      const corrected = `${state}${registrationCode}${series}${number}`;
      if (INDIAN_PLATE.test(corrected)) return corrected;
    }
  }

  return null;
};

export const normalizePlateStatus = (status) => ({
  ok: "recognized",
  recognized: "recognized",
  pending_verification: "pending_verification",
  low_confidence: "low_confidence",
  invalid_format: "invalid_format",
  not_found: "not_recognized",
  not_recognized: "not_recognized",
  plate_not_detected: "not_recognized",
  plate_not_recognized: "not_recognized",
})[String(status || "").toLowerCase()] || null;

export const resolvePlateStatus = (text, confidence, incomingStatus = null, rawText = null) => {
  if (incomingStatus === "recognized") {
    if (!text) return "not_recognized";
    if (!normalizeValidPlate(text)) return "invalid_format";
    const rawCandidate = String(rawText || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const normalizedCandidate = String(text).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (rawCandidate && rawCandidate !== normalizedCandidate) return "pending_verification";
    return Number(confidence ?? 0) >= 0.85 ? "recognized" : "low_confidence";
  }
  if (incomingStatus) return incomingStatus;
  if (!text) return "not_recognized";
  if (!normalizeValidPlate(text)) return "invalid_format";
  return Number(confidence ?? 0) >= 0.85 ? "recognized" : "low_confidence";
};
