import jwt from "jsonwebtoken";

export const authenticate = (req, res, next) => {
  try {
    const authorization = req.headers.authorization || (req.query.token ? `Bearer ${req.query.token}` : null);

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: "Authorization token is required",
      });
    }

    const [type, token] = authorization.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization format",
      });
    }

    // AI Camera internal integration bypass
    if (token === "AI_SYSTEM_INTERNAL_TOKEN_V1") {
      req.user = { id: "system", role: "AI_CAMERA" };
      return next();
    }

    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }

    const decoded = jwt.verify(token, secret);

    // Normalize role so that SUPER_ADMIN maps to ADMIN, and USER maps to STAFF
    let role = (decoded.role || "").toUpperCase();
    if (role === "SUPER_ADMIN") role = "ADMIN";
    if (role === "USER") role = "STAFF";

    req.user = {
      ...decoded,
      role,
    };

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token has expired",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }

    next(error);
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // AI Camera internal token always permitted
    if (req.user.role === "AI_CAMERA") {
      return next();
    }

    let userRole = (req.user.role || "").toUpperCase();
    if (userRole === "SUPER_ADMIN") userRole = "ADMIN";
    if (userRole === "USER") userRole = "STAFF";

    const allowed = roles.map((r) => r.toUpperCase());

    if (!allowed.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access requires [${roles.join(", ")}] role privilege. Your current role is [${userRole}].`,
      });
    }

    next();
  };
};

export default authenticate;
