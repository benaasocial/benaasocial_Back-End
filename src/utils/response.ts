import { Request, Response } from "express";


/**
 * ==============================
 * Standard Success Response Helper
 * ==============================
 *
 * Sends a consistent JSON success response.
 * Ensures all successful API responses follow the same structure.
 *
 * @param res - Express response object
 * @param data - Response payload
 * @param status - HTTP status code (default: 200)
 * @param requestId - Optional request ID for tracing
 * @param message - Optional success message
 */

export const sendSuccess = <T>(
  req: Request,
  res: Response,
  data: T,
  status = 200,
  message?: string
) => {
  return res.status(status).json({
    ok: true,
    status,
    requestId: (req as any).requestId,
    ...(message && { message }),
    data,
  });
};
