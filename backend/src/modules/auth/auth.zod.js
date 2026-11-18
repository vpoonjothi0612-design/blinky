import { z } from "zod";

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must contain at least 2 characters")
    .max(100, "Name cannot exceed 100 characters"),

  email: z
    .string()
    .trim()
    .email("Please provide a valid email address")
    .max(150, "Email cannot exceed 150 characters")
    .transform((val) => val.toLowerCase()),

  password: z
    .string()
    .min(3, "Password must contain at least 3 characters")
    .max(100, "Password cannot exceed 100 characters"),

  role: z.enum(["ADMIN", "USER", "STAFF", "SECURITY"]).optional().default("ADMIN"),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email or username is required")
    .transform((val) => val.toLowerCase()),

  password: z
    .string()
    .min(1, "Password is required"),

  role: z.enum(["ADMIN", "STAFF", "SECURITY", "USER"]).optional(),
});
