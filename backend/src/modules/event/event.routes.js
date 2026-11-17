import { Router } from "express";
import { getEventsHandler, getEventByIdHandler, createEventHandler, correctEventPlateHandler } from "./event.controller.js";
import { authenticate, authorize } from "../auth/auth.middleware.js";

const router = Router();

router.get("/", getEventsHandler);
router.post("/:id/plate-correction", authenticate, authorize("ADMIN", "SECURITY"), correctEventPlateHandler);
router.get("/:id", getEventByIdHandler);
router.post("/", createEventHandler);

export default router;
