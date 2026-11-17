import authService from "./auth.service.js";
import {
  registerSchema,
  loginSchema,
} from "./auth.zod.js";

const register = async (req, res, next) => {
  try {
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const result = await authService.register(validation.data);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validation.error.flatten().fieldErrors,
      });
    }

    const result = await authService.login(validation.data);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getAllUsers = async (req, res, next) => {
  try {
    const users = await authService.getAllUsers();
    return res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    next(error);
  }
};

const getUserById = async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.params.id);
    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

const updateUserByAdmin = async (req, res, next) => {
  try {
    const user = await authService.updateUserByAdmin(req.params.id, req.body);
    return res.status(200).json({
      success: true,
      message: "User account updated successfully",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    await authService.deleteUser(req.params.id);
    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

const protectedTest = async (req, res, next) => {
  try {
    const user = await authService.getAuthenticatedUser(req.user.id);

    return res.status(200).json({
      success: true,
      message: "Authentication successful",
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { name, email } = req.body;
    if (!name && !email) {
      return res.status(400).json({
        success: false,
        message: "At least name or email is required",
      });
    }

    const updatedUser = await authService.updateProfile(req.user.id, { name, email });
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: { user: updatedUser },
    });
  } catch (error) {
    next(error);
  }
};

const updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    const result = await authService.updatePassword(req.user.id, { currentPassword, newPassword });
    return res.status(200).json({
      success: true,
      message: result.message || "Password updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

export default {
  register,
  login,
  getAllUsers,
  getUserById,
  updateUserByAdmin,
  deleteUser,
  protectedTest,
  updateProfile,
  updatePassword,
};
