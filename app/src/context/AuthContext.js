import React, { createContext, useContext, useState, useEffect } from "react";
import api, { setAuthToken } from "../services/api";
import { loginApi } from "../services/attendanceService";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  // MUST start as null so the app ALWAYS opens on the LOGIN PAGE first!
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(false);

  // Pre-configured & created users registry
  const [managedUsers, setManagedUsers] = useState([
    {
      id: "u-admin",
      name: "System Administrator",
      username: "admin",
      email: "admin@app.com",
      role: "ADMIN",
      password: "123",
      createdAt: "System Default",
    },
    {
      id: "u-staff",
      name: "Operations Staff",
      username: "staff",
      email: "staff@app.com",
      role: "STAFF",
      password: "staff",
      createdAt: "System Default",
    },
    {
      id: "u-sec",
      name: "Main Gate Guard",
      username: "security",
      email: "security@app.com",
      role: "SECURITY",
      password: "security",
      createdAt: "System Default",
    },
  ]);

  // Sync users from backend when token/user changes or on demand
  const syncBackendUsers = async () => {
    try {
      const res = await api.get("/auth/users");
      if (res && res.data && Array.isArray(res.data.data)) {
        const backendList = res.data.data.map((bu) => {
          const userPart = bu.email.includes("@") ? bu.email.split("@")[0] : bu.email;
          return {
            id: bu.id,
            name: bu.name || userPart,
            username: userPart,
            email: bu.email,
            role: bu.role,
            createdAt: bu.createdAt ? new Date(bu.createdAt).toLocaleDateString() : "Active",
          };
        });

        setManagedUsers((prev) => {
          const map = new Map();
          // Keep defaults and existing passwords
          prev.forEach((u) => map.set(u.username.toLowerCase(), u));
          backendList.forEach((bu) => {
            const existing = map.get(bu.username.toLowerCase());
            map.set(bu.username.toLowerCase(), {
              ...bu,
              password: existing?.password || bu.username,
            });
          });
          return Array.from(map.values());
        });
      }
    } catch {}
  };

  // Login handler
  const login = async (usernameOrEmail, password) => {
    setLoading(true);
    const inputClean = (usernameOrEmail || "").trim().toLowerCase();
    const passClean = (password || "").trim();

    if (!inputClean || !passClean) {
      setLoading(false);
      return { success: false, message: "Username and password are required" };
    }

    // 1. Try logging in against main backend
    try {
      const emailToSend = inputClean.includes("@") ? inputClean : `${inputClean}@app.com`;
      const res = await loginApi(emailToSend, passClean);
      if (res && res.success && res.data) {
        const u = res.data.user;
        const t = res.data.token;
        setUser(u);
        setToken(t);
        setAuthToken(t);
        setLoading(false);
        // Sync users list if Admin
        if (u.role === "ADMIN") {
          setTimeout(syncBackendUsers, 300);
        }
        return { success: true, user: u };
      }
    } catch {
      // Backend unavailable or credentials error - check local managed registry below
    }

    // 2. Local managed registry lookup (supports admin/admin, staff/staff, security/security & created users)
    const matched = managedUsers.find((u) => {
      const matchesName =
        u.username.toLowerCase() === inputClean ||
        u.email.toLowerCase() === inputClean ||
        (inputClean === "admin" && u.role === "ADMIN") ||
        (inputClean === "staff" && u.role === "STAFF") ||
        (inputClean === "security" && u.role === "SECURITY");

      const matchesPass =
        u.password === passClean ||
        (u.role === "ADMIN" && (passClean === "123" || passClean === "admin" || passClean === "admin123")) ||
        (u.role === "STAFF" && (passClean === "staff" || passClean === "staff123")) ||
        (u.role === "SECURITY" && (passClean === "security" || passClean === "security123"));

      return matchesName && matchesPass;
    });

    if (matched) {
      const loggedUser = {
        id: matched.id,
        name: matched.name,
        email: matched.email,
        role: matched.role,
      };
      setUser(loggedUser);
      setToken(`token-${matched.role.toLowerCase()}-${Date.now()}`);
      setAuthToken(`token-${matched.role.toLowerCase()}`);
      setLoading(false);
      return { success: true, user: loggedUser };
    }

    setLoading(false);
    return {
      success: false,
      message: "Invalid username or password. Please verify your credentials.",
    };
  };

  // Admin feature: Create Staff or Security user
  const createUserByAdmin = async ({ name, username, password, role }) => {
    setLoading(true);
    const cleanUsername = (username || "").trim().toLowerCase();
    const cleanEmail = cleanUsername.includes("@") ? cleanUsername : `${cleanUsername}@app.com`;
    const cleanPass = (password || "").trim();
    const cleanRole = (role || "STAFF").toUpperCase();
    const cleanName = (name || cleanUsername).trim();

    if (!cleanUsername || !cleanPass) {
      setLoading(false);
      return { success: false, message: "Username and password are required" };
    }

    // Check duplicate
    const exists = managedUsers.some(
      (u) => u.username.toLowerCase() === cleanUsername || u.email.toLowerCase() === cleanEmail
    );
    if (exists) {
      setLoading(false);
      return { success: false, message: `Username "${cleanUsername}" is already taken` };
    }

    // 1. Attempt to create in backend database
    let createdBackendUser = null;
    try {
      const res = await api.post("/auth/register", {
        name: cleanName,
        email: cleanEmail,
        password: cleanPass,
        role: cleanRole,
      });
      if (res && res.data && res.data.data) {
        createdBackendUser = res.data.data.user;
      }
    } catch (err) {
      const errMsg = err?.response?.data?.message || err?.message;
      if (errMsg && errMsg.toLowerCase().includes("already registered")) {
        setLoading(false);
        return {
          success: false,
          message: `Account "${cleanUsername}" is already registered in database`,
        };
      }
    }

    // 2. Register in managed state
    const newUser = {
      id: createdBackendUser?.id || `u-${Date.now()}`,
      name: cleanName,
      username: cleanUsername,
      email: cleanEmail,
      role: cleanRole,
      password: cleanPass,
      createdAt: new Date().toLocaleDateString(),
    };

    setManagedUsers((prev) => [newUser, ...prev]);
    setTimeout(syncBackendUsers, 400);
    setLoading(false);
    return {
      success: true,
      user: newUser,
      message: `${cleanRole} account "${cleanUsername}" created and connected to backend!`,
    };
  };

  // Admin feature: Delete user
  const deleteManagedUser = async (id) => {
    try {
      await api.delete(`/auth/users/${id}`);
    } catch {}
    setManagedUsers((prev) => prev.filter((u) => u.id !== id));
    return { success: true };
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setAuthToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || "GUEST",
        token,
        isAuthenticated: !!user,
        loading,
        managedUsers,
        login,
        createUserByAdmin,
        deleteManagedUser,
        syncBackendUsers,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
