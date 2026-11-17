import { Router } from "express";
import { authenticate, authorize } from "../auth/auth.middleware.js";
import { getEmployeeImage } from "./employee-image.controller.js";

const router = Router();
router.get("/:employeeCode/:filename", authenticate, authorize("ADMIN", "SECURITY", "STAFF"), getEmployeeImage);
export default router;
