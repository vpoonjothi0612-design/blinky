import { z } from "zod";

export const createVehicleSchema = z.object({
  registrationNumber: z
    .string()
    .trim()
    .min(1, "Registration number is required"),

  type: z
    .string()
    .trim()
    .optional()
    .nullable(),

  make: z
    .string()
    .trim()
    .optional()
    .nullable(),

  model: z
    .string()
    .trim()
    .optional()
    .nullable(),

  color: z
    .string()
    .trim()
    .optional()
    .nullable(),

  employeeId: z
    .string()
    .uuid("Invalid employee ID format")
    .optional()
    .nullable(),

  status: z
    .enum(["ACTIVE", "INACTIVE"])
    .optional(),
});

export const updateVehicleSchema = z.object({
  registrationNumber: z
    .string()
    .trim()
    .min(1, "Registration number cannot be empty")
    .optional(),

  type: z
    .string()
    .trim()
    .optional()
    .nullable(),

  make: z
    .string()
    .trim()
    .optional()
    .nullable(),

  model: z
    .string()
    .trim()
    .optional()
    .nullable(),

  color: z
    .string()
    .trim()
    .optional()
    .nullable(),

  employeeId: z
    .string()
    .uuid("Invalid employee ID format")
    .optional()
    .nullable(),

  status: z
    .enum(["ACTIVE", "INACTIVE"])
    .optional(),
});
