
import {
  createAttendance,
  createManualAttendance,
  getAllAttendances,
  getEmployeeAttendances,
  calculateEmployeeDailyAttendance,
  registerSseClient,
  getLiveStats,
  getLatestRecognition,
  getStoredMonitoringPhotos,
} from "./attendance.service.js";

import {
  createAttendanceSchema,
  createManualAttendanceSchema,
} from "./attendance.zod.js";

import { findEmployeeByCode } from "../employee/employee.repository.js";
import Employee from "../employee/employee.model.js";
import { Op } from "sequelize";
import sequelize from "../../config/database.js";

/**
 * Robust helper to resolve an Employee record for a STAFF user account.
 * Checks case-insensitive email match, then employee name match.
 */
export const resolveStaffEmployee = async (user) => {
  if (!user) return null;
  const userEmail = (user.email || "").toLowerCase().trim();
  const userName = (user.name || "").toLowerCase().trim();

  let emp = null;
  if (userEmail) {
    emp = await Employee.findOne({
      where: sequelize.where(
        sequelize.fn("LOWER", sequelize.col("email")),
        userEmail
      ),
    });
  }

  if (!emp && userName) {
    emp = await Employee.findOne({
      where: {
        [Op.or]: [
          sequelize.where(
            sequelize.fn("LOWER", sequelize.fn("CONCAT", sequelize.col("first_name"), " ", sequelize.col("last_name"))),
            userName
          ),
          sequelize.where(
            sequelize.fn("LOWER", sequelize.col("first_name")),
            userName
          ),
        ],
      },
    });
  }

  return emp;
};

export const create = async (req, res, next) => {
  try {
    if (req.body.employeeId && !req.body.employeeId.includes("-")) {
      const emp = await findEmployeeByCode(req.body.employeeId);
      if (emp) req.body.employeeId = emp.id;
    }

    const validation = createAttendanceSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const result = await createAttendance(validation.data);

    return res.status(result.created ? 201 : 200).json({
      success: true,
      message: result.message,
      data: result.data,
      created: result.created,
    });
  } catch (error) {
    next(error);
  }
};

export const createManual = async (req, res, next) => {
  try {
    const validation = createManualAttendanceSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const result = await createManualAttendance(validation.data);

    return res.status(201).json({
      success: true,
      message: result.message,
      data: result.data,
      created: true,
    });
  } catch (error) {
    next(error);
  }
};

export const getAll = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const filters = {};

    if (req.query.source) filters.source = req.query.source;
    if (req.query.eventType) filters.eventType = req.query.eventType;

    if (req.user?.role === "STAFF") {
      const emp = await resolveStaffEmployee(req.user);

      if (!emp) {
        return res.status(200).json({
          success: true,
          message: "No attendance records found.",
          data: { count: 0, rows: [] },
        });
      }

      filters.employeeId = emp.id;
    } else if (req.query.employeeId) {
      filters.employeeId = req.query.employeeId;
    }

    const attendances = await getAllAttendances(page, limit, filters);

    return res.status(200).json({
      success: true,
      message: "Attendances retrieved successfully",
      data: attendances,
    });
  } catch (error) {
    next(error);
  }
};

export const getByEmployeeId = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const { employeeId } = req.params;

    if (req.user?.role === "STAFF") {
      const emp = await resolveStaffEmployee(req.user);
      if (!emp || emp.id !== employeeId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You can only view your own attendance records.",
        });
      }
    }

    const filters = {};

    if (req.query.source) filters.source = req.query.source;
    if (req.query.eventType) filters.eventType = req.query.eventType;

    const attendances = await getEmployeeAttendances(
      employeeId,
      page,
      limit,
      filters
    );

    return res.status(200).json({
      success: true,
      message: "Employee attendances retrieved successfully",
      data: attendances,
    });
  } catch (error) {
    next(error);
  }
};

export const getDailySummary = async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { date } = req.query;

    if (req.user?.role === "STAFF") {
      const emp = await resolveStaffEmployee(req.user);
      if (!emp || emp.id !== employeeId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You can only view your own attendance summary.",
        });
      }
    }

    const result = await calculateEmployeeDailyAttendance(employeeId, date);

    return res.status(200).json({
      success: true,
      message: "Daily attendance summary calculated successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getLiveStream = async (req, res, next) => {
  try {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    res.write(":\n\n");

    const latest = await getLatestRecognition();

    if (latest) {
      res.write(`data: ${JSON.stringify(latest)}\n\n`);
    }

    registerSseClient(res);

    const heartbeat = setInterval(() => {
      try {
        if (!res.destroyed && !res.writableEnded) {
          res.write(": heartbeat\n\n");
        } else {
          clearInterval(heartbeat);
        }
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
    });
  } catch (error) {
    next(error);
  }
};

export const getLiveStatsHandler = async (req, res, next) => {
  try {
    const stats = await getLiveStats();

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

export const getLatestRecognitionHandler = async (req, res, next) => {
  try {
    const latest = await getLatestRecognition();

    return res.status(200).json({
      success: true,
      data: latest,
    });
  } catch (error) {
    next(error);
  }
};

export const getStoredPhotosHandler = async (req, res, next) => {
  try {
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit, 10) || 100)
    );

    const photos = await getStoredMonitoringPhotos(limit);

    return res.status(200).json({
      success: true,
      count: photos.length,
      data: photos,
    });
  } catch (error) {
    next(error);
  }
};
