import { NextFunction, Response } from "express";
import ApiError from "../../middleware/ApiError";
import User from "./model";
import AppError from "../../utils/AppError";
import { sendSuccess } from "../../utils/response";
import { AuthenticatedRequest } from "../../types/express";
import { ApiFeatures } from "../../utils/ApiFeatures";
import { deleteUserPosts } from "../../utils/DeleteUserPosts";
import OAuthState from "../integrations/OAuth";
import { ConnectedAccount } from "../integrations/ConnectedAccount";

/**
 * Maps database user document to API-safe response object.
 * Prevents leaking internal fields.
 */
function userDTO(user: any) {
  return {
    id: user._id,
    name: user.username,
    email: user.email,
    role: user.role,
  };
}


export const getAllUsers = ApiError(
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    const features = new ApiFeatures(User.find().select("-password").lean(), req.query)
      .search(["username", "email"])
      .paginate(10, 50);

    const total = await User.countDocuments(features.filter);
    const items = await features.mongooseQuery.sort({ createdAt: -1 });

    // sendSuccess already includes requestId from req
    return sendSuccess(req, res, { items, meta: features.meta(total) }, 200);
  }
);



/**
 * POST /users
 * Creates a user if email is not already registered.
 */

export const createUser = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const email = req.body.email

  // Check if a user with the same email already exists
  const exists = await User.findOne({ email });

  if (exists) {
    return next(
      new AppError(
        "User already exists",
        409
      )
    );
  }




  // Create the user (override email with normalized value)
  const newUser = new User(req.body);



  // Save to database
  await newUser.save();


  // Return the created user
  return sendSuccess(
    req,
    res,
    { user: userDTO(newUser) },
    201,
    "User created successfully"
  );
};


/**
 * Delete a user by ID.
 * - If the user doesn't exist, return 404.
 * - Otherwise delete and return the deleted user.
 */


export const deleteUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.params.id as string;

    const user = await User.findById(userId);

    if (!user) {
      return next(new AppError("User not found", 404));
    }

    const deletedPostsCount = await deleteUserPosts(userId);

    const [connectedAccountsResult, oauthStatesResult] = await Promise.all([
      ConnectedAccount.deleteMany({ userId }),
      OAuthState.deleteMany({ userId }),
    ]);

    await User.findByIdAndDelete(userId);

    return sendSuccess(
      req,
      res,
      {
        user: userDTO(user),
        deletedPostsCount,
        deletedConnectedAccountsCount:
          connectedAccountsResult.deletedCount ?? 0,
        deletedOAuthStatesCount:
          oauthStatesResult.deletedCount ?? 0,
      },
      200,
      "User deleted successfully"
    );
  } catch (error) {
    return next(error);
  }
};