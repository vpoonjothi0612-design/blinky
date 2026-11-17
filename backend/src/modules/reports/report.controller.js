import * as reportService from "./report.service.js";
import { attendanceReportSchema, summaryReportSchema } from "./report.validator.js";
import Employee from "../employee/employee.model.js";

export const getAttendanceReport = async (req, res, next) => {
  try {
    const validation = attendanceReportSchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const queryData = { ...validation.data };

    // Strict Ownership Scoping: STAFF role can only generate reports for their own employee record
    if (req.user && req.user.role === "STAFF") {
      const emp = await Employee.findOne({ where: { email: req.user.email } });
      queryData.employeeId = emp ? emp.id : "00000000-0000-0000-0000-000000000000";
    }

    const report = await reportService.getAttendanceReport(queryData);

    return res.status(200).json({
      success: true,
      message: "Attendance report retrieved successfully",
      data: report,
    });
  } catch (error) {
    next(error);
  }
};

export const getSummaryReport = async (req, res, next) => {
  try {
    const validation = summaryReportSchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const queryData = { ...validation.data };

    // Strict Ownership Scoping: STAFF role can only query summary for their own employee record
    if (req.user && req.user.role === "STAFF") {
      const emp = await Employee.findOne({ where: { email: req.user.email } });
      queryData.employeeId = emp ? emp.id : "00000000-0000-0000-0000-000000000000";
    }

    const summary = await reportService.getSummaryReport(queryData);

    return res.status(200).json({
      success: true,
      message: "Summary report retrieved successfully",
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};
