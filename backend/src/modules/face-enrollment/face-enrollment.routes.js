import { Router } from "express";
import {
  create,
  getAll,
  getById,
  getByEmployeeId,
  update,
  remove,
  bulkRemove,
  captureUnknown,
  getUnknown,
  assignUnknown,
  registerUnknown,
} from "./face-enrollment.controller.js";

import { authenticate, authorize } from "../auth/auth.middleware.js";
import uploadSingleImage from "../../middleware/upload.middleware.js";

const router = Router();

// Unrecognized Faces & Visitor Surveillance (Admin & Security)
router.post("/capture-unknown", authenticate, captureUnknown);
router.get("/unknown", authenticate, authorize("ADMIN", "SECURITY"), getUnknown);
router.put("/:id/assign", authenticate, authorize("ADMIN", "SECURITY"), assignUnknown);
router.put("/:id/register", authenticate, authorize("ADMIN", "SECURITY"), registerUnknown);

// Biometric Face Registry CRUD (Admin Only)
router.post("/bulk-delete", authenticate, authorize("ADMIN"), bulkRemove);
router.post("/", authenticate, authorize("ADMIN"), uploadSingleImage, create);
router.get("/", authenticate, authorize("ADMIN"), getAll);
router.get("/:id", authenticate, authorize("ADMIN"), getById);
router.get("/employee/:employeeId", authenticate, authorize("ADMIN"), getByEmployeeId);
router.put("/:id", authenticate, authorize("ADMIN"), update);
router.delete("/:id", authenticate, authorize("ADMIN"), remove);

export default router;
