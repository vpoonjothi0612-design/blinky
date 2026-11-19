import { z } from "zod";

const rtspUrlSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return !url.username && !url.password;
    } catch {
      return !/^rtsps?:\/\/[^/]*@/i.test(value);
    }
  }, "Do not embed camera credentials in the RTSP URL; configure them in the AI service environment.");

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

  rtspUrl: rtspUrlSchema,

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

  rtspUrl: rtspUrlSchema,

  status: z
    .enum(["ACTIVE", "INACTIVE"])
    .optional(),
});
