import { NextFunction, Response } from "express";
import AppError from "../utils/AppError";
import { AuthenticatedRequest } from "../types/express";

const authorize = (...roles: string[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    // check if user is authenticated
    if (!req.user) return next(new AppError("Unauthorized", 401));


    // check if user has the required role
    if (!roles.includes(req.user.role)) {
      return next(new AppError("Forbidden", 403));
    }

    
    return next();
  };
};

export default authorize;