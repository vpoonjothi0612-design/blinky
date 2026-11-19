import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Op } from "sequelize";
import Attendance from "./attendance.model.js";
import sequelize from "../../config/database.js";
import {
  createAttendance as createAttendanceRepo,
  findAllAttendances,
  findAttendancesByEmployeeId,
  findRecentAttendance,
  findAttendanceByEventId,
  findEmployeeDayEvents,
} from "./attendance.repository.js";
import Employee from "../employee/employee.model.js";
import Camera from "../camera/camera.model.js";
import Shift from "../shifts/shift.model.js";
import Holiday from "../holiday/holiday.model.js";
import Leave from "../leave/leave.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const capturesDir = path.resolve(__dirname, "../../../../ai-services/data/captures");
const unknownDir = path.resolve(__dirname, "../../../../ai-services/data/unknown");

// Real-Time SSE Broadcaster for Live Attendance Monitoring Dashboard
const sseClients = new Set();
const recentLiveEvents = [];
let latestRecognitionEvent = null;

export const registerSseClient = (res) => {
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
};

export const broadcastLiveEvent = (event) => {
  latestRecognitionEvent = event;
  recentLiveEvents.unshift(event);
  if (recentLiveEvents.length > 50) recentLiveEvents.pop();

  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
};

export const getLatestLiveRecognition = () => latestRecognitionEvent;
export const getRecentLiveEvents = () => [...recentLiveEvents];

// Helper: resolve employee by UUID or Employee Code
export const resolveEmployee = async (idOrCode) => {
  if (!idOrCode) {
    const error = new Error("Employee identifier is required");
    error.statusCode = 400;
    throw error;
  }

  // Try by UUID or code
  let emp;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode)) {
    emp = await Employee.findByPk(idOrCode, {
      include: [{ model: Shift, as: "shift" }],
    });
  } else {
    emp = await Employee.findOne({
      where: { employeeCode: idOrCode },
      include: [{ model: Shift, as: "shift" }],
    });
  }

  if (!emp) {
    const error = new Error(`Employee '${idOrCode}' not found`);
    error.statusCode = 404;
    throw error;
  }
  if (emp.status && emp.status !== "ACTIVE") {
    const error = new Error(`Employee '${idOrCode}' is inactive; attendance cannot be recorded`);
    error.statusCode = 400;
    throw error;
  }
  return emp;
};

// Resolve camera identity using the database record or logical camera ID.
export const resolveCamera = async (idOrNameOrIp) => {
  if (!idOrNameOrIp) return null;

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNameOrIp)) {
    return await Camera.findByPk(idOrNameOrIp);
  }

  return await Camera.findOne({
    where: {
      [Op.or]: [{ name: idOrNameOrIp }, { ipAddress: idOrNameOrIp }],
    },
  });
};

// Helper: Get active shift for an employee (or default shift)
export const getActiveShiftForEmployee = async (employee) => {
  if (employee && employee.shift) {
    return employee.shift;
  }
  if (employee && employee.shiftId) {
    const s = await Shift.findByPk(employee.shiftId);
    if (s) return s;
  }
  // Fall back to any active shift
  const defaultShift = await Shift.findOne({ where: { isActive: true } });
  return (
    defaultShift || {
      name: "General Shift",
      startTime: "09:00:00",
      endTime: "18:00:00",
      gracePeriod: 15,
      breakDuration: 60,
      isCrossMidnight: false,
    }
  );
};

// Helper: Determine status (LATE vs PRESENT) based on shift in Asia/Kolkata timezone
export const evaluatePunchStatus = (timestamp, eventType, shift) => {
  if (eventType !== "IN" || !shift || !shift.startTime) {
    return "PRESENT";
  }

  const punchDate = new Date(timestamp);
  if (isNaN(punchDate.getTime())) {
    return "PRESENT";
  }

  const [startH, startM] = shift.startTime.split(":").map(Number);

  // Interpret punch in Asia/Kolkata (IST: UTC+05:30)
  const kolkataTimeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(punchDate);
  const [punchH, punchM] = kolkataTimeStr.split(":").map(Number);

  const punchMinutesOfDay = punchH * 60 + punchM;
  const shiftStartMinutesOfDay = startH * 60 + startM;
  const graceMinutes = shift.gracePeriod || 0;

  if (punchMinutesOfDay > shiftStartMinutesOfDay + graceMinutes) {
    return "LATE";
  }
  return "PRESENT";
};

export const createAttendance = async (data) => {
  // 1. Resolve Employee & enforce active status
  const employee = await resolveEmployee(data.employeeId);
  const employeeId = employee.id;

  // 2. Resolve Camera & validate directional mapping
  const camera = await resolveCamera(data.cameraId);
  const cameraId = camera ? camera.id : null;
  const cameraIdentifier = (camera ? camera.name : data.cameraId || "").toUpperCase();
  const cameraAddress = String(camera?.ipAddress || data.cameraId || "").trim();
  const camera1Address = String(process.env.CAMERA_1_IP || "").trim();
  const camera2Address = String(process.env.CAMERA_2_IP || "").trim();

  const eventType = data.eventType === "OUT" ? "OUT" : "IN";

  const isExitCamera =
    /CAM-?0?1/.test(cameraIdentifier) ||
    (camera1Address && cameraAddress === camera1Address);
  const isEntryCamera =
    /CAM-?0?2/.test(cameraIdentifier) ||
    (camera2Address && cameraAddress === camera2Address);

  if (isExitCamera) {
    if (eventType !== "OUT") {
      const error = new Error("Camera 'CAM-01' is dedicated to exit (OUT events) and cannot generate IN events");
      error.statusCode = 400;
      throw error;
    }
  } else if (isEntryCamera) {
    if (eventType !== "IN") {
      const error = new Error("Camera 'CAM-02' is dedicated to entry (IN events) and cannot generate OUT events");
      error.statusCode = 400;
      throw error;
    }
  }

  const now = data.timestamp ? new Date(data.timestamp) : new Date();

  // 3. Idempotent check via eventId
  if (data.eventId) {
    const existingByEventId = await findAttendanceByEventId(data.eventId);
    if (existingByEventId) {
      return {
        created: false,
        message: "Duplicate eventId ignored (idempotent)",
        data: existingByEventId,
      };
    }
  }

  // 4. Duplicate frame protection (60-second cooldown per employee and event type / camera)
  const cooldownSec = Number(process.env.ATTENDANCE_COOLDOWN_SEC) || 60;
  const cooldownWindowStart = new Date(now.getTime() - cooldownSec * 1000);
  const cooldownWindowEnd = new Date(now.getTime() + cooldownSec * 1000);

  const recentAttendance = await findRecentAttendance(
    employeeId,
    cameraId || null,
    eventType,
    cooldownWindowStart,
    cooldownWindowEnd
  );

  if (recentAttendance) {
    return {
      created: false,
      message: `Attendance ignored due to ${cooldownSec}-second duplicate frame cooldown`,
      data: recentAttendance,
    };
  }

  // 5. Attendance status: Respect provided status (e.g. "PRESENT"), otherwise evaluate against shift
  let status = data.status;
  if (!status) {
    const shift = await getActiveShiftForEmployee(employee);
    status = evaluatePunchStatus(now, eventType, shift);
  }

  // 6. Database Transaction
  const transaction = await sequelize.transaction();
  try {
    const normalizedSource = data.source === "MANUAL" ? "MANUAL" : "AI_CAMERA";
    const attendance = await createAttendanceRepo(
      {
        employeeId,
        cameraId: cameraId || null,
        timestamp: now,
        eventType,
        similarity: data.similarity !== undefined ? data.similarity : null,
        eventId: data.eventId || null,
        status,
        source: normalizedSource,
        capturedImage: data.capturedImage || null,
      },
      { transaction }
    );

    await transaction.commit();

    // Construct live recognition event for real-time monitoring dashboard
    try {
      const photoPath = data.capturedImage
        ? `/captured-images/${data.capturedImage}`
        : `/enrollment-images/${employee.employeeCode}/${employee.employeeCode}_angle_01_front.jpg`;

      const liveEvent = {
        type: "EMPLOYEE_RECOGNIZED",
        eventId: attendance.eventId || attendance.id,
        attendanceId: attendance.id,
        employeeId: employee.employeeCode,
        employeeCode: employee.employeeCode,
        employeeDbId: employee.id,
        name: `${employee.firstName} ${employee.lastName || ""}`.trim(),
        firstName: employee.firstName,
        lastName: employee.lastName,
        department: employee.department || "Engineering",
        designation: employee.designation || "Staff",
        email: employee.email,
        cameraId: camera ? camera.name : (data.cameraId || (eventType === "OUT" ? "CAM-01" : "CAM-02")),
        cameraName: camera ? camera.name : (eventType === "OUT" ? "CAM-01 (Exit)" : "CAM-02 (Entry)"),
        cameraLocation: camera ? camera.location : "Main Gate",
        eventType,
        similarity: data.similarity !== undefined ? Number(data.similarity) : 0.95,
        timestamp: now.toISOString(),
        status,
        capturedImage: data.capturedImage || null,
        photoUrl: photoPath,
      };

      broadcastLiveEvent(liveEvent);
    } catch (bErr) {
      console.warn("[AttendanceService] Live broadcast notice:", bErr.message);
    }

    return {
      created: true,
      message: `Attendance ${eventType} event recorded successfully`,
      data: attendance,
    };
  } catch (error) {
    await transaction.rollback();
    // In case of race condition unique constraint violation on event_id
    if (error.name === "SequelizeUniqueConstraintError" && data.eventId) {
      const existing = await findAttendanceByEventId(data.eventId);
      if (existing) {
        return {
          created: false,
          message: "Duplicate eventId ignored (idempotent)",
          data: existing,
        };
      }
    }
    throw error;
  }
};

export const createManualAttendance = async (data) => {
  const employee = await resolveEmployee(data.employeeId);
  const employeeId = employee.id;
  const cameraId = await resolveCamera(data.cameraId);

  const checkInTime = data.checkInTime || data.time;
  if (!checkInTime) {
    const error = new Error("Check-in time is required");
    error.statusCode = 400;
    throw error;
  }

  const dateStr = data.date;
  const checkInIso = `${dateStr}T${checkInTime.length === 5 ? checkInTime + ":00" : checkInTime}`;
  const checkInTimestamp = new Date(checkInIso);

  if (isNaN(checkInTimestamp.getTime())) {
    const error = new Error("Invalid check-in date/time format");
    error.statusCode = 400;
    throw error;
  }

  // Create IN record
  const checkInResult = await createAttendance({
    employeeId,
    cameraId: cameraId || null,
    timestamp: checkInTimestamp,
    eventType: "IN",
    status: data.status || "PRESENT",
    source: "MANUAL",
  });

  if (!checkInResult.created && !data.checkOutTime) {
    return checkInResult;
  }

  // Create OUT record if checkOutTime provided
  if (data.checkOutTime) {
    const checkOutIso = `${dateStr}T${data.checkOutTime.length === 5 ? data.checkOutTime + ":00" : data.checkOutTime}`;
    const checkOutTimestamp = new Date(checkOutIso);

    if (isNaN(checkOutTimestamp.getTime())) {
      const error = new Error("Invalid check-out time format");
      error.statusCode = 400;
      throw error;
    }

    if (checkOutTimestamp <= checkInTimestamp) {
      const error = new Error("Check-out time must be after check-in time");
      error.statusCode = 400;
      throw error;
    }

    const checkOutResult = await createAttendance({
      employeeId,
      cameraId: cameraId || null,
      timestamp: checkOutTimestamp,
      eventType: "OUT",
      status: "PRESENT",
      source: "MANUAL",
    });

    return {
      created: true,
      message: "Manual attendance (IN & OUT) recorded successfully",
      data: {
        checkIn: checkInResult.data,
        checkOut: checkOutResult.data,
      },
    };
  }

  return checkInResult;
};

export const getAllAttendances = async (page = 1, limit = 50, filters = {}) => {
  const offset = (page - 1) * limit;
  const result = await findAllAttendances({ offset, limit, ...filters });
  const rows = (result.rows || []).map((att) => {
    const plain = att.toJSON ? att.toJSON() : { ...att };
    const emp = plain.employee || {};
    const empCode = emp.employeeCode;
    plain.photoUrl = plain.capturedImage
      ? `/captured-images/${plain.capturedImage}`
      : empCode
      ? `/enrollment-images/${empCode}/${empCode}_angle_01_front.jpg`
      : null;
    return plain;
  });
  return {
    count: result.count,
    rows,
  };
};

export const getEmployeeAttendances = async (employeeId, page = 1, limit = 50, filters = {}) => {
  const emp = await resolveEmployee(employeeId);
  const offset = (page - 1) * limit;
  const result = await findAttendancesByEmployeeId(emp.id, { offset, limit, ...filters });
  const rows = (result.rows || []).map((att) => {
    const plain = att.toJSON ? att.toJSON() : { ...att };
    const empCode = plain.employee?.employeeCode || emp.employeeCode;
    plain.photoUrl = plain.capturedImage
      ? `/captured-images/${plain.capturedImage}`
      : empCode
      ? `/enrollment-images/${empCode}/${empCode}_angle_01_front.jpg`
      : null;
    return plain;
  });
  return {
    count: result.count,
    rows,
  };
};

// Calculate detailed daily attendance metrics including shifts, late/early, working duration, leaves, holidays
export const calculateEmployeeDailyAttendance = async (employeeId, dateString) => {
  const employee = await resolveEmployee(employeeId);
  const targetDate = dateString || new Date().toISOString().split("T")[0];

  // 1. Check Holiday
  const holiday = await Holiday.findOne({ where: { date: targetDate } });
  if (holiday) {
    return {
      date: targetDate,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: `${employee.firstName} ${employee.lastName || ""}`.trim(),
      status: "HOLIDAY",
      holidayName: holiday.name,
      workingDurationMinutes: 0,
      firstPunchIn: null,
      lastPunchOut: null,
    };
  }

  // 2. Check Approved Leave
  const leave = await Leave.findOne({
    where: {
      employeeId: employee.id,
      status: "APPROVED",
      startDate: { [Op.lte]: targetDate },
      endDate: { [Op.gte]: targetDate },
    },
  });
  if (leave) {
    return {
      date: targetDate,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: `${employee.firstName} ${employee.lastName || ""}`.trim(),
      status: "LEAVE",
      leaveType: leave.type,
      workingDurationMinutes: 0,
      firstPunchIn: null,
      lastPunchOut: null,
    };
  }

  // 3. Shift details
  const shift = await getActiveShiftForEmployee(employee);
  const isCrossMidnight = shift.isCrossMidnight || (shift.startTime > shift.endTime);

  // Use Asia/Kolkata day boundaries for accurate local day calculation
  const startOfDay = new Date(`${targetDate}T00:00:00+05:30`);
  let endOfDay = new Date(`${targetDate}T23:59:59.999+05:30`);

  if (isCrossMidnight) {
    // Extend end boundary into next calendar day up to shift end + grace
    endOfDay = new Date(startOfDay.getTime() + 36 * 3600 * 1000);
  }

  const events = await findEmployeeDayEvents(employee.id, startOfDay, endOfDay);

  const inEvents = events.filter((e) => e.eventType === "IN");
  const outEvents = events.filter((e) => e.eventType === "OUT");

  const firstIn = inEvents.length > 0 ? inEvents[0] : null;
  const lastOut = outEvents.length > 0 ? outEvents[outEvents.length - 1] : null;

  // Cutoff calculation for ABSENT evaluated in Asia/Kolkata
  const cutoffSetting = process.env.ATTENDANCE_CUTOFF_TIME || "18:00";
  const [cutoffH, cutoffM] = cutoffSetting.split(":").map(Number);
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const currentHourKolkata = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now)
  );
  const currentMinKolkata = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", minute: "2-digit", hour12: false }).format(now)
  );

  let status = "PENDING";
  if (events.length > 0) {
    const hasLate = inEvents.some((e) => e.status === "LATE");
    status = hasLate ? "LATE" : "PRESENT";
  } else {
    // No events
    if (targetDate < todayStr) {
      status = "ABSENT";
    } else if (targetDate === todayStr) {
      const isPastCutoff =
        currentHourKolkata > cutoffH || (currentHourKolkata === cutoffH && currentMinKolkata >= cutoffM);
      status = isPastCutoff ? "ABSENT" : "PENDING";
    }
  }

  // Reconcile working intervals across all IN and OUT punches (supporting re-entry & split shifts)
  let calculatedTotalMinutes = 0;
  const workingIntervals = [];
  let currentIn = null;
  let isAmbiguousSequence = false;
  const ambiguityNotes = [];

  for (const evt of events) {
    if (evt.eventType === "IN") {
      if (currentIn) {
        isAmbiguousSequence = true;
        ambiguityNotes.push(`Repeated entry punch (IN) at ${new Date(evt.timestamp).toISOString()}`);
      }
      currentIn = evt;
    } else if (evt.eventType === "OUT") {
      if (!currentIn) {
        isAmbiguousSequence = true;
        ambiguityNotes.push(`Exit punch (OUT) at ${new Date(evt.timestamp).toISOString()} without preceding entry`);
      } else {
        const inMs = new Date(currentIn.timestamp).getTime();
        const outMs = new Date(evt.timestamp).getTime();
        if (outMs > inMs) {
          const duration = Math.round((outMs - inMs) / 60000);
          calculatedTotalMinutes += duration;
          workingIntervals.push({
            inTime: currentIn.timestamp,
            outTime: evt.timestamp,
            durationMinutes: duration,
          });
        }
        currentIn = null;
      }
    }
  }

  let totalDurationMinutes = calculatedTotalMinutes;
  let netDurationMinutes = 0;
  if (totalDurationMinutes > 0) {
    const breakMins = shift.breakDuration || 0;
    netDurationMinutes = Math.max(0, totalDurationMinutes - breakMins);
  }

  let lateArrivalMinutes = 0;
  let earlyDepartureMinutes = 0;

  if (firstIn) {
    const [sH, sM] = (shift.startTime || "09:00:00").split(":").map(Number);
    const expectedStart = new Date(
      `${targetDate}T${String(sH).padStart(2, "0")}:${String(sM).padStart(2, "0")}:00+05:30`
    );
    const graceMs = (shift.gracePeriod || 0) * 60 * 1000;

    const actualInTime = new Date(firstIn.timestamp).getTime();
    if (actualInTime > expectedStart.getTime() + graceMs) {
      lateArrivalMinutes = Math.round((actualInTime - expectedStart.getTime()) / 60000);
    }
  }

  if (lastOut) {
    const [eH, eM] = (shift.endTime || "18:00:00").split(":").map(Number);
    let expectedEnd = new Date(
      `${targetDate}T${String(eH).padStart(2, "0")}:${String(eM).padStart(2, "0")}:00+05:30`
    );
    if (isCrossMidnight) {
      expectedEnd = new Date(expectedEnd.getTime() + 24 * 3600 * 1000);
    }

    const graceMs = (shift.gracePeriod || 0) * 60 * 1000;
    const outMs = new Date(lastOut.timestamp).getTime();
    if (outMs < expectedEnd.getTime() - graceMs) {
      earlyDepartureMinutes = Math.round((expectedEnd.getTime() - outMs) / 60000);
    }
  }

  const isIncomplete = Boolean((firstIn && !lastOut) || (!firstIn && lastOut) || isAmbiguousSequence);
  const incompleteReason = (firstIn && !lastOut)
    ? "Missing exit punch (OUT)"
    : (!firstIn && lastOut)
    ? "Missing entry punch (IN)"
    : isAmbiguousSequence
    ? ambiguityNotes.join("; ")
    : null;

  return {
    date: targetDate,
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    employeeName: `${employee.firstName} ${employee.lastName || ""}`.trim(),
    shift: {
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      gracePeriod: shift.gracePeriod,
      breakDuration: shift.breakDuration,
      isCrossMidnight,
    },
    status,
    firstPunchIn: firstIn ? firstIn.timestamp : null,
    lastPunchOut: lastOut ? lastOut.timestamp : null,
    entryCamera: firstIn ? (firstIn.camera?.name || (firstIn.cameraId ? "CAM-02" : "CAM-02")) : null,
    exitCamera: lastOut ? (lastOut.camera?.name || (lastOut.cameraId ? "CAM-01" : "CAM-01")) : null,
    isIncomplete,
    incompleteReason,
    isAmbiguousSequence,
    reconciliationNotes: ambiguityNotes.length > 0 ? ambiguityNotes.join("; ") : null,
    workingIntervals,
    totalDurationMinutes,
    netDurationMinutes,
    lateArrivalMinutes,
    earlyDepartureMinutes,
    totalEvents: events.length,
    events,
  };
};



export const getLiveStats = async () => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [inCount, outCount, distinctEmployees, totalToday] = await Promise.all([
    Attendance.count({
      where: {
        eventType: "IN",
        timestamp: { [Op.gte]: startOfDay },
      },
    }),
    Attendance.count({
      where: {
        eventType: "OUT",
        timestamp: { [Op.gte]: startOfDay },
      },
    }),
    Attendance.count({
      distinct: true,
      col: "employee_id",
      where: {
        eventType: "IN",
        timestamp: { [Op.gte]: startOfDay },
      },
    }),
    Attendance.count({
      where: {
        timestamp: { [Op.gte]: startOfDay },
      },
    }),
  ]);

  // Read AI camera status telemetry if available
  let aiStatus = null;
  try {
    const statusFilePath = path.resolve(__dirname, "../../../../ai-services/data/ai_camera_status.json");
    if (fs.existsSync(statusFilePath)) {
      aiStatus = JSON.parse(fs.readFileSync(statusFilePath, "utf8"));
    }
  } catch {
    // ignore
  }
  if (
    !aiStatus ||
    aiStatus.status !== "RUNNING" ||
    !Number.isFinite(Date.parse(aiStatus.updated_at)) ||
    Date.now() - Date.parse(aiStatus.updated_at) > 15_000
  ) {
    aiStatus = null;
  }

  // Unknown faces count
  let unknownCount = 0;
  try {
    const FaceEnrollment = (await import("../face-enrollment/face-enrollment.model.js")).default;
    unknownCount = await FaceEnrollment.count({
      where: {
        status: { [Op.ne]: "COMPLETED" },
      },
    });
  } catch {
    // fallback
  }

  // Animal and Vehicle counts today
  let animalCount = 0;
  let vehicleCount = 0;
  try {
    const SurveillanceEvent = (await import("../event/event.model.js")).default;
    animalCount = await SurveillanceEvent.count({
      where: {
        eventType: "ANIMAL_DETECTED",
        createdAt: { [Op.gte]: startOfDay },
      },
    });
    vehicleCount = await SurveillanceEvent.count({
      where: {
        eventType: { [Op.in]: ["VEHICLE_IN", "VEHICLE_OUT"] },
        createdAt: { [Op.gte]: startOfDay },
      },
    });
  } catch {
    // fallback
  }

  const cameraStatuses = Object.entries(aiStatus?.cameras || {}).reduce((safeStatuses, [cameraId, camera]) => {
    if (!camera || typeof camera !== "object") return safeStatuses;
    const {
      configured,
      event_type,
      connected,
      connection_state,
      resolution,
      codec,
      acquisition_fps,
      processing_fps,
      processing_latency_ms,
      frames_received,
      frames_processed,
      dropped_frames,
      reconnect_count,
      last_error,
      faces_detected,
      registered_identified,
      unknown_tracks,
      attendance_recorded,
    } = camera;
    safeStatuses[cameraId] = {
      configured,
      event_type,
      connected,
      connection_state,
      resolution,
      codec,
      acquisition_fps,
      processing_fps,
      processing_latency_ms,
      frames_received,
      frames_processed,
      dropped_frames,
      reconnect_count,
      last_error: typeof last_error === "string"
        ? last_error.replace(/(rtsps?:\/\/[^:/@\s]+):[^@\s]*@/gi, "$1:***@")
        : last_error,
      faces_detected,
      registered_identified,
      unknown_tracks,
      attendance_recorded,
    };
    return safeStatuses;
  }, {});
  const measuredFps = Object.values(cameraStatuses)
    .map((camera) => Number(camera?.processing_fps ?? camera?.fps))
    .filter((fps) => Number.isFinite(fps));
  const currentFps = measuredFps.length > 0 ? Math.max(...measuredFps) : null;
  const activeCameras = Object.values(cameraStatuses)
    .filter((camera) => camera?.connected === true).length;

  // Aggregate telemetry from AI cameras if available
  const cam1Faces = cameraStatuses["CAM-01"]?.faces_detected || 0;
  const cam2Faces = cameraStatuses["CAM-02"]?.faces_detected || 0;
  const aiFacesDetected = cam1Faces + cam2Faces;

  const cam1Rec = cameraStatuses["CAM-01"]?.registered_identified || 0;
  const cam2Rec = cameraStatuses["CAM-02"]?.registered_identified || 0;
  const aiEmployeesRecognized = cam1Rec + cam2Rec;

  const cam1Unknown = cameraStatuses["CAM-01"]?.unknown_tracks || 0;
  const cam2Unknown = cameraStatuses["CAM-02"]?.unknown_tracks || 0;
  const aiUnknownFaces = cam1Unknown + cam2Unknown;

  return {
    todayPresent: distinctEmployees,
    inCount,
    outCount,
    totalToday,
    animalCount,
    vehicleCount,
    totalFacesDetected: aiFacesDetected > 0 ? aiFacesDetected : (totalToday + unknownCount),
    employeesRecognized: aiEmployeesRecognized > 0 ? aiEmployeesRecognized : totalToday,
    unknownCount: aiUnknownFaces > 0 ? aiUnknownFaces : unknownCount,
    activeCameras,
    currentFps,
    aiStatus: aiStatus?.status || "UNKNOWN",
    cameras: cameraStatuses["CAM-01"] || cameraStatuses["CAM-02"]
      ? cameraStatuses
      : {
        "CAM-01": { configured: null, connected: false, connection_state: "UNKNOWN", event_type: "OUT" },
        "CAM-02": { configured: null, connected: false, connection_state: "UNKNOWN", event_type: "IN" },
    },
  };
};

export const getLatestRecognition = async () => {
  if (latestRecognitionEvent) {
    return latestRecognitionEvent;
  }

  const latest = await Attendance.findOne({
    order: [["timestamp", "DESC"]],
    include: [
      {
        model: Employee,
        as: "employee",
        attributes: ["id", "employeeCode", "firstName", "lastName", "department", "designation", "email"],
      },
      { model: Camera, as: "camera", attributes: ["id", "name", "location"] },
    ],
  });

  if (!latest || !latest.employee) return null;

  const emp = latest.employee;
  const cam = latest.camera;

  return {
    type: "EMPLOYEE_RECOGNIZED",
    eventId: latest.eventId || latest.id,
    attendanceId: latest.id,
    employeeId: emp.employeeCode,
    employeeCode: emp.employeeCode,
    employeeDbId: emp.id,
    name: `${emp.firstName} ${emp.lastName || ""}`.trim(),
    firstName: emp.firstName,
    lastName: emp.lastName,
    department: emp.department || "Engineering",
    designation: emp.designation || "Staff",
    email: emp.email,
    cameraId: cam ? cam.name : (latest.eventType === "OUT" ? "CAM-01" : "CAM-02"),
    cameraName: cam ? cam.name : (latest.eventType === "OUT" ? "CAM-01 (Exit)" : "CAM-02 (Entry)"),
    cameraLocation: cam ? cam.location : "Main Gate",
    eventType: latest.eventType,
    similarity: latest.similarity || 0.95,
    timestamp: latest.timestamp,
    status: latest.status || "PRESENT",
    capturedImage: latest.capturedImage || null,
    photoUrl: latest.capturedImage ? `/captured-images/${latest.capturedImage}` : null,
  };
};


export const getStoredMonitoringPhotos = async (limit = 100) => {
  const photos = [];

  // 1. Scan ai-services/data/captures (Live recognized & active monitoring photos)
  if (fs.existsSync(capturesDir)) {
    try {
      const files = fs.readdirSync(capturesDir);
      for (const f of files) {
        if (!/\.(jpg|jpeg|png)$/i.test(f)) continue;
        const filePath = path.join(capturesDir, f);
        try {
          const stats = fs.statSync(filePath);
          let type = "RECOGNIZED";
          let employeeCode = null;
          let cameraId = "CAM-02";

          if (f.startsWith("recognized_")) {
            const parts = f.replace(/\.jpe?g$/i, "").split("_");
            if (parts.length >= 4) {
              cameraId = parts[1];
              employeeCode = parts[2];
            }
            type = "RECOGNIZED";
          } else if (f.startsWith("latest_")) {
            type = "CURRENT_MONITORING";
            cameraId = f.includes("CAM-01") ? "CAM-01" : "CAM-02";
          } else if (f.startsWith("current_")) {
            type = "CURRENT_MONITORING";
            cameraId = f.includes("CAM-01") ? "CAM-01" : "CAM-02";
          } else {
            type = "LIVE_SNAPSHOT";
          }

          photos.push({
            filename: f,
            url: `/captured-images/${f}`,
            type,
            employeeCode,
            cameraId,
            timestamp: stats.mtime.toISOString(),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          });
        } catch {}
      }
    } catch (err) {
      console.warn("[AttendanceService] Error reading captures dir:", err.message);
    }
  }

  // 2. Scan ai-services/data/unknown (Unknown visitor face captures)
  if (fs.existsSync(unknownDir)) {
    try {
      const uFiles = fs.readdirSync(unknownDir);
      for (const uf of uFiles) {
        if (!/\.(jpg|jpeg|png)$/i.test(uf)) continue;
        const filePath = path.join(unknownDir, uf);
        try {
          const stats = fs.statSync(filePath);
          let cameraId = "CAM-02";
          let trackId = null;

          if (uf.includes("CAM-01")) cameraId = "CAM-01";
          if (uf.includes("trk")) {
            const m = uf.match(/trk(\d+)/);
            if (m) trackId = m[1];
          }

          photos.push({
            filename: uf,
            url: `/unknown-images/${uf}`,
            type: "UNKNOWN",
            employeeCode: null,
            trackId,
            cameraId,
            timestamp: stats.mtime.toISOString(),
            size: stats.size,
            mtimeMs: stats.mtimeMs,
          });
        } catch {}
      }
    } catch (err) {
      console.warn("[AttendanceService] Error reading unknown dir:", err.message);
    }
  }

  // Sort descending by timestamp (newest first)
  photos.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return photos.slice(0, limit);
};
