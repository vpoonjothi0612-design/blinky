import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import authRepository from "./auth.repository.js";

const generateToken = (user) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    const error = new Error("JWT_SECRET is not configured");
    error.status = 500;
    throw error;
  }

  let role = (user.role || "").toUpperCase();
  if (role === "SUPER_ADMIN") role = "ADMIN";
  if (role === "USER") role = "STAFF";

  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role,
    },
    secret,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );
};

const register = async ({ name, email, password, role }) => {
  const cleanEmail = (email || "").trim().toLowerCase();
  const existingUser = await authRepository.findByEmail(cleanEmail);

  if (existingUser) {
    const error = new Error("Email is already registered");
    error.status = 409;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  let assignedRole = (role || "ADMIN").toUpperCase();
  if (assignedRole === "USER") assignedRole = "STAFF";

  const user = await authRepository.createUser({
    name: name.trim(),
    email: cleanEmail,
    password: hashedPassword,
    rawPassword: password, // For admin visibility in user management
    role: assignedRole,
    isActive: true,
  });

  const normalizedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: assignedRole,
    isActive: user.isActive,
    rawPassword: user.rawPassword,
  };

  const token = generateToken(normalizedUser);

  return {
    user: normalizedUser,
    token,
  };
};

const login = async ({ email, password, role }) => {
  const identifier = (email || "").trim().toLowerCase();

  // Find user by either email or username/name
  let user = await authRepository.findByNameOrEmail(identifier);

  if (!user) {
    const error = new Error("Invalid email or password");
    error.status = 401;
    throw error;
  }

  if (user.isActive === false) {
    const error = new Error("Account is deactivated. Please contact your administrator.");
    error.status = 403;
    throw error;
  }

  // Determine user's effective system role
  let userRole = (user.role || "").toUpperCase();
  if (userRole === "SUPER_ADMIN") userRole = "ADMIN";
  if (userRole === "USER") userRole = "STAFF";

  // Validate password strictly against bcrypt hash
  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    const error = new Error("Invalid email or password");
    error.status = 401;
    throw error;
  }

  // Verify role if a specific role was selected on the login page
  if (role) {
    let reqRole = role.toUpperCase();
    if (reqRole === "USER") reqRole = "STAFF";
    // Allow ADMIN to log into any role panel, but restrict others to their assigned role
    if (userRole !== reqRole && userRole !== "ADMIN") {
      const error = new Error(
        `Your account has the ${userRole} role. Please select ${userRole} to sign in.`
      );
      error.status = 403;
      throw error;
    }
  }

  // Update rawPassword if not set or changed
  if (!user.rawPassword || user.rawPassword !== password) {
    try {
      await authRepository.updateUser(user.id, { rawPassword: password });
    } catch (_) {}
  }

  const normalizedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: userRole,
    isActive: user.isActive,
  };

  const token = generateToken(normalizedUser);

  return {
    user: normalizedUser,
    token,
  };
};

const getAuthenticatedUser = async (userId) => {
  const user = await authRepository.findById(userId);

  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  let role = (user.role || "").toUpperCase();
  if (role === "SUPER_ADMIN") role = "ADMIN";
  if (role === "USER") role = "STAFF";

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    isActive: user.isActive,
  };
};

const getAllUsers = async () => {
  const users = await authRepository.findAll();
  return users.map((u) => {
    const raw = typeof u.toJSON === "function" ? u.toJSON() : { ...u };
    let role = (raw.role || "").toUpperCase();
    if (role === "SUPER_ADMIN") role = "ADMIN";
    if (role === "USER") role = "STAFF";
    return {
      ...raw,
      role,
    };
  });
};

const getUserById = async (userId) => {
  const user = await authRepository.findById(userId);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }
  const raw = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  let role = (raw.role || "").toUpperCase();
  if (role === "SUPER_ADMIN") role = "ADMIN";
  if (role === "USER") role = "STAFF";
  return {
    ...raw,
    role,
  };
};

const updateUserByAdmin = async (userId, data) => {
  const user = await authRepository.findById(userId);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  if (data.email && data.email !== user.email) {
    const existing = await authRepository.findByEmail(data.email);
    if (existing && existing.id !== userId) {
      const error = new Error("Email is already taken by another account");
      error.status = 409;
      throw error;
    }
  }

  const updatePayload = {};
  if (data.name !== undefined) updatePayload.name = data.name;
  if (data.email !== undefined) updatePayload.email = data.email.toLowerCase().trim();
  if (data.role !== undefined) updatePayload.role = data.role.toUpperCase();
  if (data.isActive !== undefined) updatePayload.isActive = Boolean(data.isActive);

  if (data.password && data.password.trim()) {
    updatePayload.password = await bcrypt.hash(data.password.trim(), 10);
    updatePayload.rawPassword = data.password.trim();
  }

  const updated = await authRepository.updateUser(userId, updatePayload);
  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    isActive: updated.isActive,
    rawPassword: updated.rawPassword,
    created_at: updated.created_at,
    updated_at: updated.updated_at,
  };
};

const deleteUser = async (userId) => {
  return authRepository.deleteUser(userId);
};

const updateProfile = async (userId, { name, email }) => {
  const user = await authRepository.findById(userId);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  if (email && email !== user.email) {
    const existing = await authRepository.findByEmail(email);
    if (existing && existing.id !== userId) {
      const error = new Error("Email is already taken");
      error.status = 409;
      throw error;
    }
  }

  const updated = await authRepository.updateUser(userId, {
    ...(name ? { name } : {}),
    ...(email ? { email: email.toLowerCase().trim() } : {}),
  });

  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    isActive: updated.isActive,
  };
};

const updatePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await authRepository.findByIdWithPassword(userId);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const matches = await bcrypt.compare(currentPassword, user.password);
  if (!matches) {
    const error = new Error("Current password does not match");
    error.status = 400;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await authRepository.updateUser(userId, {
    password: hashedPassword,
    rawPassword: newPassword,
  });

  return { message: "Password updated successfully" };
};

export default {
  register,
  login,
  getAuthenticatedUser,
  getAllUsers,
  getUserById,
  updateUserByAdmin,
  deleteUser,
  updateProfile,
  updatePassword,
};
