import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Attendance & Vehicle Detection API is running",
    timestamp: new Date().toISOString(),
  });
});

export default router;