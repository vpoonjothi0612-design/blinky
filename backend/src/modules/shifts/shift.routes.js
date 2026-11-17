import { Router } from "express";
import {
  create,
  getAll,
  getById,
  update,
  remove,
} from "./shift.controller.js";
import { authenticate, authorize } from "../auth/auth.middleware.js";

const router = Router();

// Shift Reading
router.get("/", authenticate, authorize("ADMIN", "STAFF", "SECURITY"), getAll);
router.get("/:id", authenticate, authorize("ADMIN", "STAFF", "SECURITY"), getById);

// Shift Configuration (Admin Only)
router.post("/", authenticate, authorize("ADMIN"), create);
router.put("/:id", authenticate, authorize("ADMIN"), update);
router.delete("/:id", authenticate, authorize("ADMIN"), remove);

export default router;
