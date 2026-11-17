import { z } from "zod";

export const createCameraSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Camera name is required"),

  location: z
    .string()
    .trim()
    .optional()
    .nullable(),

  ipAddress: z
    .string()
    .trim()
    .optional()
    .nullable(),

  rtspUrl: z
    .string()
    .trim()
    .optional()
    .nullable(),

  status: z
    .enum(["ACTIVE", "INACTIVE"])
    .optional(),
});

export const updateCameraSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Camera name cannot be empty")
    .optional(),

  location: z
    .string()
    .trim()
    .optional()
    .nullable(),

  ipAddress: z
    .string()
    .trim()
    .optional()
    .nullable(),

  rtspUrl: z
    .string()
    .trim()
    .optional()
    .nullable(),

  status: z
    .enum(["ACTIVE", "INACTIVE"])
    .optional(),
});
