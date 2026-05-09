import { NextFunction, Request, Response } from "express"


/**
 * ==============================
 * Async Controller Wrapper
 * ==============================
 *
 * Wraps controller functions to catch async errors and forward them
 * to the global error handler using next(err).
 *
 * This prevents having to write try/catch in every async controller.
 */



type ControllerReturn = void | Response | Promise<void | Response>;

const ApiError = (
  callback: (req: Request, res: Response, next: NextFunction) => ControllerReturn
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Ensures both sync and async errors are forwarded to Express error handler
    Promise.resolve(callback(req, res, next)).catch(next);
  };
};

export default ApiError;