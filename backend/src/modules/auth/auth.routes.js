import { Router } from "express";
import authController from "./auth.controller.js";
import { authenticate, authorize } from "./auth.middleware.js";

const router = Router();

router.post("/register", authController.register);
router.post("/login", authController.login);

// Administrative User Provisioning & Management (Strictly ADMIN only)
router.get("/users", authenticate, authorize("ADMIN"), authController.getAllUsers);
router.get("/users/:id", authenticate, authorize("ADMIN"), authController.getUserById);
router.put("/users/:id", authenticate, authorize("ADMIN"), authController.updateUserByAdmin);
router.delete("/users/:id", authenticate, authorize("ADMIN"), authController.deleteUser);

// Personal profile & security
router.get("/protected-test", authenticate, authController.protectedTest);
router.put("/profile", authenticate, authController.updateProfile);
router.put("/change-password", authenticate, authController.updatePassword);

export default router;
