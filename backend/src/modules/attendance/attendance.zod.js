import { z } from "zod";

export const createAttendanceSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  cameraId: z.string().optional().nullable(),
  eventType: z.enum(["IN", "OUT"]).optional().default("IN"),
  similarity: z.number().min(0).max(1).optional().nullable(),
  eventId: z.string().optional().nullable(),
  capturedImage: z.string().optional().nullable(),
  timestamp: z
    .string()
    .optional()
    .nullable()
    .refine((val) => !val || !isNaN(Date.parse(val)), "Invalid timestamp format"),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "OVERTIME", "LEAVE", "OD"]).optional(),
  source: z.string().optional().default("AI_CAMERA"),
});

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createManualAttendanceSchema = z
  .object({
    employeeId: z.string().min(1, "Employee ID is required"),
    date: z
      .string()
      .regex(dateRegex, "Date must be in YYYY-MM-DD format")
      .refine((val) => !isNaN(Date.parse(val)), "Invalid date"),
    checkInTime: z
      .string()
      .regex(timeRegex, "Check-in time must be in HH:mm or HH:mm:ss format")
      .optional(),
    time: z
      .string()
      .regex(timeRegex, "Time must be in HH:mm or HH:mm:ss format")
      .optional(),
    checkOutTime: z
      .string()
      .regex(timeRegex, "Check-out time must be in HH:mm or HH:mm:ss format")
      .optional()
      .nullable(),
    eventType: z.enum(["IN", "OUT"]).optional(),
    status: z
      .enum(["PRESENT", "ABSENT", "LATE", "OVERTIME", "LEAVE", "OD"])
      .optional()
      .default("PRESENT"),
    cameraId: z.string().optional().nullable(),
  })
  .refine((data) => Boolean(data.checkInTime || data.time), {
    message: "Check-in time is required",
    path: ["checkInTime"],
  })
  .refine(
    (data) => {
      const checkIn = data.checkInTime || data.time;
      if (data.checkOutTime && checkIn) {
        return data.checkOutTime > checkIn;
      }
      return true;
    },
    {
      message: "Check-out time must be after check-in time",
      path: ["checkOutTime"],
    },
  );
