import { NextFunction, Request, Response } from "express";
import crypto from "crypto";

/**
 * ==============================
 * Request ID Middleware
 * ==============================
 *
 * - Generates a unique ID for each incoming request.
 * - Preserves existing x-request-id header if provided (e.g., from API Gateway).
 * - Attaches requestId to req object.
 * - Returns requestId in response headers for tracing.
 */

const requestId = (req: Request, res: Response, next: NextFunction) => {

  // Use existing request ID if provided, otherwise generate a new UUID
  const id =
    (req.headers["x-request-id"] as string) ||
    `req_${crypto.randomUUID()}`;

  // Attach ID to request object for logging and tracing
  (req as any).requestId = id;

  // Expose request ID in response headers
  res.setHeader("x-request-id", id);

  next();
};

export default requestId;