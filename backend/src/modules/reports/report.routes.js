import { Router } from "express";
import { getAttendanceReport, getSummaryReport } from "./report.controller.js";
import { authenticate, authorize } from "../auth/auth.middleware.js";

const router = Router();

router.get("/attendance", authenticate, authorize("ADMIN", "STAFF", "SECURITY"), getAttendanceReport);
router.get("/summary", authenticate, authorize("ADMIN", "STAFF", "SECURITY"), getSummaryReport);

export default router;
