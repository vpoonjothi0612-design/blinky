import { Router } from "express";
import { authenticate } from "../auth/auth.middleware.js";
import { getMedia } from "./media.controller.js";

const router = Router();
router.get("/:key", authenticate, getMedia);

export default router;
