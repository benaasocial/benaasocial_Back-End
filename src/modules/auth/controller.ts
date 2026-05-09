import { NextFunction, Request, Response } from "express";
import ApiError from "../../middleware/ApiError";
import User from "../user/model";
import AppError from "../../utils/AppError";
import { AuthenticatedRequest } from "../../types/express";
import { sendSuccess } from "../../utils/response";

/**
 * ==============================
 * User DTO (Data Transfer Object)
 * ==============================
 * Returns only safe user fields to the client.
 * Prevents leaking sensitive fields (e.g. password, internal metadata).
 */
function userDTO(user: any) {
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

/**
 * ==============================
 * Login Controller
 * ==============================
 * - Finds user by email
 * - Validates password
 * - Generates JWT token
 * - Returns token + safe user data
 */
export const loginController = ApiError(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email }).select("+password");;

    // Compare password only if user exists
    const isPasswordCorrect = await user?.comparePassword(password);

    // Return 401 for invalid credentials (do not reveal which field is wrong)
    if (!user || !isPasswordCorrect) {
      return next(new AppError("Invalid credentials", 401));
    }

    // Generate access token (JWT or similar)
    const token = await user.generateToken();

    // Send standardized success response
    return sendSuccess(
      req,
      res,
      { token, user: userDTO(user) },
      200,
      "Login successful"
    );
  }
);

/**
 * ==============================
 * Get Current User (Me)
 * ==============================
 * Requires authentication middleware to attach req.user.
 * Fetches user from DB and returns safe user data.
 */
export const getMe = ApiError(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // req.user is set by auth middleware
    const user = await User.findById(req.user?._id).select("-password");

    // If user does not exist in DB
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Use DTO to keep response consistent
    return sendSuccess(
      req,
      res,
      { user: userDTO(user) },
      200,
      "User profile"
    );
  }
);