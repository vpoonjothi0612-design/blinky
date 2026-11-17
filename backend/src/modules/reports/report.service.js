import { Op } from "sequelize";
import Employee from "../employee/employee.model.js";
import Attendance from "../attendance/attendance.model.js";
import Shift from "../shifts/shift.model.js";
import Holiday from "../holiday/holiday.model.js";
import Leave from "../leave/leave.model.js";
import Camera from "../camera/camera.model.js";

const TIMEZONE = process.env.TIMEZONE || process.env.COMPANY_TIMEZONE || "Asia/Kolkata";

const getLocalTimeBoundaries = (dateString) => {
  // Assuming dateString is "YYYY-MM-DD"
  const start = new Date(`${dateString}T00:00:00`);
  const end = new Date(`${dateString}T23:59:59.999`);
  return { start, end };
};

export const getAttendanceReport = async (filters) => {
  const { startDate, endDate, employeeId, status } = filters;

  const { start } = getLocalTimeBoundaries(startDate || new Date().toISOString().split("T")[0]);
  const { end } = getLocalTimeBoundaries(endDate || startDate || new Date().toISOString().split("T")[0]);

  const employeeWhere = { status: "ACTIVE" };
  if (employeeId) employeeWhere.id = employeeId;

  const employees = await Employee.findAll({
    where: employeeWhere,
    include: [{ model: Shift, as: "shift" }],
    attributes: ["id", "employeeCode", "firstName", "lastName", "shiftId"],
  });

  const employeeIds = employees.map((e) => e.id);

  if (employeeIds.length === 0) {
    return [];
  }

  // Get active default shift in case some employee doesn't have an assigned shift
  const defaultShift = (await Shift.findOne({ where: { isActive: true } })) || {
    name: "General Shift",
    startTime: "09:00:00",
    endTime: "18:00:00",
    gracePeriod: 15,
    breakDuration: 60,
    isCrossMidnight: false,
  };

  // Fetch all holidays in range
  const holidays = await Holiday.findAll({
    where: {
      date: {
        [Op.between]: [
          start.toISOString().split("T")[0],
          end.toISOString().split("T")[0],
        ],
      },
    },
  });
  const holidayMap = {};
  holidays.forEach((h) => {
    holidayMap[h.date] = h.name;
  });

  // Fetch all approved leaves in range
  const leaves = await Leave.findAll({
    where: {
      status: "APPROVED",
      employeeId: { [Op.in]: employeeIds },
      [Op.or]: [
        {
          startDate: {
            [Op.between]: [
              start.toISOString().split("T")[0],
              end.toISOString().split("T")[0],
            ],
          },
        },
        {
          endDate: {
            [Op.between]: [
              start.toISOString().split("T")[0],
              end.toISOString().split("T")[0],
            ],
          },
        },
      ],
    },
  });

  const attendanceWhere = {
    employeeId: { [Op.in]: employeeIds },
    timestamp: { [Op.between]: [start, end] },
  };

  const attendances = await Attendance.findAll({
    where: attendanceWhere,
    include: [
      {
        model: Employee,
        as: "employee",
        attributes: ["id", "employeeCode", "firstName", "lastName"],
      },
      {
        model: Camera,
        as: "camera",
        attributes: ["id", "name", "location"],
      },
    ],
    order: [
      ["employeeId", "ASC"],
      ["timestamp", "ASC"],
    ],
  });

  const grouped = {};
  attendances.forEach((att) => {
    // Format date string in configured timezone
    const dStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(att.timestamp));

    const eKey = att.employeeId;
    if (!grouped[eKey]) grouped[eKey] = {};
    if (!grouped[eKey][dStr]) grouped[eKey][dStr] = [];
    grouped[eKey][dStr].push(att);
  });

  const report = [];

  const cutoffSetting = process.env.ATTENDANCE_CUTOFF_TIME || "18:00";
  const [cutoffHour, cutoffMinute] = cutoffSetting.split(":").map(Number);
  const now = new Date();
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  for (const emp of employees) {
    const shift = emp.shift || defaultShift;
    const isCrossMidnight = shift.isCrossMidnight || shift.startTime > shift.endTime;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);

      // Check Holiday
      if (holidayMap[dateKey]) {
        if (!status || status === "HOLIDAY") {
          report.push({
            date: dateKey,
            employeeId: emp.id,
            employeeCode: emp.employeeCode,
            employeeName: `${emp.firstName} ${emp.lastName || ""}`.trim(),
            shiftName: shift.name,
            status: "HOLIDAY",
            holidayName: holidayMap[dateKey],
            source: null,
            firstPunch: null,
            lastPunch: null,
            workingDurationMinutes: 0,
            netWorkingMinutes: 0,
            lateArrivalMinutes: 0,
            earlyDepartureMinutes: 0,
            rawRecords: [],
          });
        }
        continue;
      }

      // Check Leave
      const employeeLeave = leaves.find(
        (l) => l.employeeId === emp.id && dateKey >= l.startDate && dateKey <= l.endDate
      );
      if (employeeLeave) {
        if (!status || status === "LEAVE") {
          report.push({
            date: dateKey,
            employeeId: emp.id,
            employeeCode: emp.employeeCode,
            employeeName: `${emp.firstName} ${emp.lastName || ""}`.trim(),
            shiftName: shift.name,
            status: "LEAVE",
            leaveType: employeeLeave.type,
            source: "MANUAL",
            firstPunch: null,
            lastPunch: null,
            workingDurationMinutes: 0,
            netWorkingMinutes: 0,
            lateArrivalMinutes: 0,
            earlyDepartureMinutes: 0,
            rawRecords: [],
          });
        }
        continue;
      }

      const dayAtts = grouped[emp.id] && grouped[emp.id][dateKey] ? grouped[emp.id][dateKey] : [];

      const inEvents = dayAtts.filter((a) => a.eventType === "IN");
      const outEvents = dayAtts.filter((a) => a.eventType === "OUT");

      const hasPresent = dayAtts.some((a) => a.status === "PRESENT" || a.status === "OVERTIME");
      const hasLate = dayAtts.some((a) => a.status === "LATE");
      const hasOD = dayAtts.some((a) => a.status === "OD" || a.status === "OFFICIAL_DUTY");
      const hasAbsentRecord = dayAtts.some((a) => a.status === "ABSENT");

      let effectiveStatus = "";
      if (hasLate) effectiveStatus = "LATE";
      else if (hasPresent) effectiveStatus = "PRESENT";
      else if (hasOD) effectiveStatus = "OD";
      else if (hasAbsentRecord) effectiveStatus = "ABSENT";
      else {
        // Cutoff evaluation
        if (dateKey < todayKey) {
          effectiveStatus = "ABSENT";
        } else if (dateKey === todayKey) {
          const currentHour = now.getHours();
          const currentMinute = now.getMinutes();
          const isPastCutoff =
            currentHour > cutoffHour ||
            (currentHour === cutoffHour && currentMinute >= cutoffMinute);
          if (isPastCutoff) effectiveStatus = "ABSENT";
          else effectiveStatus = "PENDING";
        } else {
          effectiveStatus = "FUTURE";
        }
      }

      if (status && effectiveStatus !== status) continue;

      let firstPunch = null;
      let lastPunch = null;
      let firstPunchCamera = null;
      let lastPunchCamera = null;
      let isIncomplete = false;
      let incompleteReason = null;
      let source = null;
      let workingDurationMinutes = 0;
      let netWorkingMinutes = 0;
      let lateArrivalMinutes = 0;
      let earlyDepartureMinutes = 0;

      if (dayAtts.length > 0) {
        firstPunch = inEvents.length > 0 ? inEvents[0].timestamp : null;
        lastPunch = outEvents.length > 0 ? outEvents[outEvents.length - 1].timestamp : null;
        firstPunchCamera = inEvents.length > 0 ? (inEvents[0].camera?.name || "CAM-02") : null;
        lastPunchCamera = outEvents.length > 0 ? (outEvents[outEvents.length - 1].camera?.name || "CAM-01") : null;

        isIncomplete = Boolean((firstPunch && !lastPunch) || (!firstPunch && lastPunch));
        incompleteReason = (firstPunch && !lastPunch)
          ? "Missing exit punch (OUT)"
          : (!firstPunch && lastPunch)
          ? "Missing entry punch (IN)"
          : null;

        const primaryRecord = dayAtts.find((a) => a.status === effectiveStatus) || dayAtts[0];
        source = primaryRecord.source;

        // Calculate late arrival
        if (inEvents.length > 0 && shift.startTime) {
          const [sH, sM] = shift.startTime.split(":").map(Number);
          const expectedStart = new Date(`${dateKey}T00:00:00`);
          expectedStart.setHours(sH, sM, 0, 0);
          const graceMs = (shift.gracePeriod || 0) * 60 * 1000;
          const actualInTime = new Date(inEvents[0].timestamp).getTime();
          if (actualInTime > expectedStart.getTime() + graceMs) {
            lateArrivalMinutes = Math.round((actualInTime - expectedStart.getTime()) / 60000);
          }
        }

        // Calculate duration and early departure
        if (inEvents.length > 0 && outEvents.length > 0) {
          const inMs = new Date(inEvents[0].timestamp).getTime();
          const outMs = new Date(outEvents[outEvents.length - 1].timestamp).getTime();
          if (outMs > inMs) {
            workingDurationMinutes = Math.round((outMs - inMs) / 60000);
            netWorkingMinutes = Math.max(
              0,
              workingDurationMinutes - (shift.breakDuration || 0)
            );
          }

          if (shift.endTime) {
            const [eH, eM] = shift.endTime.split(":").map(Number);
            const expectedEnd = new Date(`${dateKey}T00:00:00`);
            if (isCrossMidnight) {
              expectedEnd.setDate(expectedEnd.getDate() + 1);
            }
            expectedEnd.setHours(eH, eM, 0, 0);
            const graceMs = (shift.gracePeriod || 0) * 60 * 1000;
            if (outMs < expectedEnd.getTime() - graceMs) {
              earlyDepartureMinutes = Math.round((expectedEnd.getTime() - outMs) / 60000);
            }
          }
        }
      }

      report.push({
        date: dateKey,
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: `${emp.firstName} ${emp.lastName || ""}`.trim(),
        shiftName: shift.name,
        status: effectiveStatus,
        source,
        firstPunch,
        lastPunch,
        firstPunchCamera,
        lastPunchCamera,
        isIncomplete,
        incompleteReason,
        workingDurationMinutes,
        netWorkingMinutes,
        lateArrivalMinutes,
        earlyDepartureMinutes,
        rawRecords: dayAtts,
      });
    }
  }

  return report;
};

export const getSummaryReport = async (filters) => {
  const { date, startDate, endDate, employeeId, status } = filters;

  const start = startDate || date;
  const end = endDate || date;

  const reportData = await getAttendanceReport({
    startDate: start,
    endDate: end,
    employeeId,
    status,
  });

  const summary = {
    date: start === end ? start || new Date().toISOString().split("T")[0] : `${start} to ${end}`,
    totalEmployees: reportData.length,
    totalPresent: 0,
    totalLate: 0,
    totalAbsent: 0,
    totalLeave: 0,
    totalHoliday: 0,
    totalOD: 0,
  };

  reportData.forEach((row) => {
    if (row.status === "PRESENT" || row.status === "LATE") {
      summary.totalPresent++;
    }
    if (row.status === "LATE") summary.totalLate++;
    else if (row.status === "ABSENT") summary.totalAbsent++;
    else if (row.status === "LEAVE") summary.totalLeave++;
    else if (row.status === "HOLIDAY") summary.totalHoliday++;
    else if (row.status === "OD") summary.totalOD++;
  });

  return summary;
};
