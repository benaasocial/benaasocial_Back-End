import { NextFunction, Request, Response } from "express";
import logger from "../utils/logger";

/**
 * ==============================
 * Global Error Handler Middleware
 * ==============================
 * 
 * Centralized error handling for the entire application.
 * Ensures consistent error response format.
 * Logs server errors for debugging.
 */
const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {

  // Default to 500 if status not provided
  const status = err.statusCode || 500;

  // Log unexpected server errors (5xx)
  if (status >= 500) {
    logger.error("Unhandled server error", {
      message: err.message,
      stack: err.stack,
      requestId: (req as any).requestId,
    });
  }

  res.status(status).json({
    ok: false,
    status,

    // Useful for tracing logs in production
    requestId: (req as any).requestId,

    error: {
      code: err.code || "APP_ERROR",
      message: err.message || "Internal Server Error",
      details: err.errors || [],
      retryable: status >= 500,
    },

    // Only expose stack trace in development
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

export default globalErrorHandler;