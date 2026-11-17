import { z } from "zod";

export const createEnrollmentSchema = z.object({
  employeeId: z
    .string()
    .uuid("Invalid employee ID format"),
  
  embedding: z
    .array(z.number())
    .min(1, "Embedding cannot be empty")
    .optional(),

  images: z
    .object({
      front: z.string().optional().nullable(),
      left: z.string().optional().nullable(),
      right: z.string().optional().nullable(),
      photos: z.array(z.string()).min(3).max(5).optional(),
    })
    .optional()
    .nullable(),

  photoUrl: z.string().optional().nullable(),
});

export const updateEnrollmentSchema = z.object({
  embedding: z
    .array(z.number())
    .min(1, "Embedding cannot be empty")
    .optional(),

  images: z
    .object({
      front: z.string().optional().nullable(),
      left: z.string().optional().nullable(),
      right: z.string().optional().nullable(),
      photos: z.array(z.string()).min(3).max(5).optional(),
    })
    .optional()
    .nullable(),

  photoUrl: z.string().optional().nullable(),
});
