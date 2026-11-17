import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const attendanceReportSchema = z.object({
  startDate: z.string().regex(dateRegex, "Start date must be YYYY-MM-DD format").optional(),
  endDate: z.string().regex(dateRegex, "End date must be YYYY-MM-DD format").optional(),
  department: z.string().optional(),
  status: z.string().optional().transform((v) => (v && v.trim() !== "" ? v.toUpperCase() : undefined)),
  employeeId: z.string().optional().transform((v) => (v && v.trim() !== "" ? v : undefined)),
});

export const summaryReportSchema = z.object({
  date: z.string().regex(dateRegex, "Date must be YYYY-MM-DD format").optional(),
  startDate: z.string().regex(dateRegex, "Start date must be YYYY-MM-DD format").optional(),
  endDate: z.string().regex(dateRegex, "End date must be YYYY-MM-DD format").optional(),
  department: z.string().optional(),
  status: z.string().optional().transform((v) => (v && v.trim() !== "" ? v.toUpperCase() : undefined)),
  employeeId: z.string().optional().transform((v) => (v && v.trim() !== "" ? v : undefined)),
});

