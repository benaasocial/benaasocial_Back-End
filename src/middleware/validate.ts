import { NextFunction, Request, Response } from "express";
import { ZodTypeAny } from "zod";
import AppError from "../utils/AppError";

const validate = (schema: ZodTypeAny) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse({ ...req.body, ...req.params, ...req.query });

    if (!result.success) {
      const errors = result.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));

      return next(new AppError("Invalid input", 400, errors));
    }

    return next();
  };
};

export default validate;