import { Router } from "express";
import { authenticate, authorize } from "../auth/auth.middleware.js";
import { crossingDetail, crossingSummary, listCrossings } from "./crossing.controller.js";

const router = Router();
router.use(authenticate, authorize("ADMIN", "SECURITY"));
router.get("/summary", crossingSummary);
router.get("/:id", crossingDetail);
router.get("/", listCrossings);

export default router;
