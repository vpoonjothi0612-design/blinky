import { Op } from "sequelize";
import Attendance from "./attendance.model.js";
import Employee from "../employee/employee.model.js";
import Camera from "../camera/camera.model.js";

export const createAttendance = async (data, options = {}) => {
  return Attendance.create(data, options);
};

export const findAttendanceByEventId = async (eventId, options = {}) => {
  if (!eventId) return null;
  return Attendance.findOne({
    where: { eventId },
    include: [
      { model: Employee, as: "employee", attributes: ["id", "employeeCode", "firstName", "lastName", "department", "designation", "email"] },
      { model: Camera, as: "camera", attributes: ["id", "name", "location"] },
    ],
    ...options,
  });
};

export const findAllAttendances = async ({ offset = 0, limit = 50, source, employeeId, eventType } = {}) => {
  const where = {};
  if (source && (source === "AI_CAMERA" || source === "MANUAL")) {
    where.source = source;
  }
  if (employeeId) {
    where.employeeId = employeeId;
  }
  if (eventType && (eventType === "IN" || eventType === "OUT")) {
    where.eventType = eventType;
  }

  return Attendance.findAndCountAll({
    where,
    include: [
      { model: Employee, as: "employee", attributes: ["id", "employeeCode", "firstName", "lastName", "department", "designation", "email"] },
      { model: Camera, as: "camera", attributes: ["id", "name", "location"] },
    ],
    order: [["timestamp", "DESC"]],
    offset,
    limit,
  });
};

export const findAttendancesByEmployeeId = async (employeeId, { offset = 0, limit = 50, source, eventType } = {}) => {
  const where = { employeeId };
  if (source && (source === "AI_CAMERA" || source === "MANUAL")) {
    where.source = source;
  }
  if (eventType && (eventType === "IN" || eventType === "OUT")) {
    where.eventType = eventType;
  }

  return Attendance.findAndCountAll({
    where,
    include: [
      { model: Employee, as: "employee", attributes: ["id", "employeeCode", "firstName", "lastName", "department", "designation", "email"] },
      { model: Camera, as: "camera", attributes: ["id", "name", "location"] },
    ],
    order: [["timestamp", "DESC"]],
    offset,
    limit,
  });
};

export const findRecentAttendance = async (
  employeeId,
  cameraId = null,
  eventType = null,
  sinceTimestamp = null,
  untilTimestamp = null,
  options = {}
) => {
  const timeCondition = untilTimestamp
    ? { [Op.between]: [sinceTimestamp, untilTimestamp] }
    : { [Op.gte]: sinceTimestamp };

  const whereClause = {
    employeeId,
    timestamp: timeCondition,
  };

  if (eventType) {
    whereClause.eventType = eventType;
  }

  if (cameraId) {
    whereClause.cameraId = cameraId;
  }

  return Attendance.findOne({
    where: whereClause,
    order: [["timestamp", "DESC"]],
    ...options,
  });
};

export const findEmployeeDayEvents = async (employeeId, startDateTime, endDateTime) => {
  return Attendance.findAll({
    where: {
      employeeId,
      timestamp: {
        [Op.between]: [startDateTime, endDateTime],
      },
    },
    include: [
      { model: Camera, as: "camera", attributes: ["id", "name", "location"] },
    ],
    order: [["timestamp", "ASC"]],
  });
};

