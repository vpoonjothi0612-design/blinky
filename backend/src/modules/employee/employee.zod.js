import { z } from "zod";

export const createEmployeeSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .optional()
    .nullable(),

  firstName: z
    .string()
    .trim()
    .min(1, "First name is required"),

  lastName: z
    .string()
    .trim()
    .optional()
    .nullable(),

  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .optional()
    .nullable(),

  phone: z
    .string()
    .trim()
    .optional()
    .nullable(),

  department: z
    .string()
    .trim()
    .optional()
    .nullable(),

  designation: z
    .string()
    .trim()
    .optional()
    .nullable(),

  joiningDate: z
    .string()
    .trim()
    .optional()
    .nullable(),

  status: z
    .enum(["ACTIVE", "INACTIVE"])
    .optional(),
});

export const updateEmployeeSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .min(1, "Employee code cannot be empty")
    .optional(),

  firstName: z
    .string()
    .trim()
    .min(1, "First name cannot be empty")
    .optional(),

  lastName: z
    .string()
    .trim()
    .optional()
    .nullable(),

  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .optional()
    .nullable(),

  phone: z
    .string()
    .trim()
    .optional()
    .nullable(),

  department: z
    .string()
    .trim()
    .optional()
    .nullable(),

  designation: z
    .string()
    .trim()
    .optional()
    .nullable(),

  joiningDate: z
    .string()
    .trim()
    .optional()
    .nullable(),

  status: z
    .enum(["ACTIVE", "INACTIVE"])
    .optional(),
});