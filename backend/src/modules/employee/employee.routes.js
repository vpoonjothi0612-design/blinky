import { Router } from "express";

import {
  create,
  getAll,
  getNextCode,
  getById,
  getByCode,
  update,
  remove,
  bulkDelete,
} from "./employee.controller.js";

import { authenticate, authorize } from "../auth/auth.middleware.js";

const router = Router();

// Employee Lookup & Verification (Admin & Security read-only)
router.get("/", authenticate, authorize("ADMIN", "SECURITY", "STAFF"), getAll);
router.get("/next-code", authenticate, authorize("ADMIN", "SECURITY"), getNextCode);
router.get("/code/:employeeCode", authenticate, authorize("ADMIN", "SECURITY"), getByCode);
router.get("/:id", authenticate, authorize("ADMIN", "SECURITY"), getById);

// Employee Management (Strictly ADMIN)
router.post("/", authenticate, authorize("ADMIN"), create);
router.post("/bulk-delete", authenticate, authorize("ADMIN"), bulkDelete);
router.put("/:id", authenticate, authorize("ADMIN"), update);
router.delete("/:id", authenticate, authorize("ADMIN"), remove);

export default router;
