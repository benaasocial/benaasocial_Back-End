import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import AppError from "../utils/AppError";
import { AuthenticatedRequest } from "../types/express";
import { IUserPayload } from "../types/user";

/**
 * ==============================
 * Authentication Middleware
 * ==============================
 *
 * - Extracts JWT token from Authorization header (Bearer <token>)
 * - Verifies the token using JWT_SECRET
 * - Attaches decoded payload to req.user
 * - Forwards errors to global error handler
 */
const authenticate = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  // Read Authorization header
  const authHeader = req.headers.authorization;

  // Require Bearer token
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new AppError("Unauthorized", 401));
  }

  // Extract token value after "Bearer "
  const token = authHeader.split(" ")[1];

  // Ensure JWT secret exists (server configuration)
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return next(new AppError("Server misconfigured", 500));
  }

  try {
    // Verify and decode token payload
    const decoded = jwt.verify(token, secret) as IUserPayload;

    // Attach payload to request for downstream handlers
    req.user = decoded;

    return next();
  } catch {
    // Token invalid/expired
    return next(new AppError("Invalid token", 401));
  }
};

export default authenticate;