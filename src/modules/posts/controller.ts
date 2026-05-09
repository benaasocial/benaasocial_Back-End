import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "../../types/express";
import AppError from "../../utils/AppError";
import Post from "./model";
import { sendSuccess } from "../../utils/response";
import { ApiFeatures } from "../../utils/ApiFeatures";



import {
  publishPost,
  retryPostPublishing,
} from "./post.publish.service";
import { deletePostMediaFromCloudinary } from "../../utils/DeleteFromCloudinary";

export const createPost = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const userId = req.user?._id;
  if (!userId) return next(new AppError("Unauthorized", 401));

  const result = await publishPost({
    userId: String(userId),
    action: req.body.action,
    caption: req.body.caption,
    hashtags: req.body.hashtags,
    targets: req.body.targets,
    media: req.body.media,
    tiktokSettings: req.body.tiktokSettings,
    youtubeSettings: req.body.youtubeSettings,
  });

  return sendSuccess(
    req,
    res,
    result,
    201,
    result.note || "Post created successfully"
  );
};

export const retryPublishPost = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const user = req.user;
  if (!user?._id) return next(new AppError("Unauthorized", 401));

  const postId =
    typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];

  if (!postId) {
    return next(new AppError("Invalid post id", 400));
  }

  const platform =
    typeof req.query.platform === "string" ? req.query.platform : undefined;

  const result = await retryPostPublishing({
    postId,
    requesterId: String(user._id),
    requesterRole: String(user.role || ""),
    onlyPlatform: platform,

    tiktokSettings: {
      privacy_level: "SELF_ONLY",
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
    },

    youtubeSettings: {
      privacyStatus: "public",
    },
  });

  return sendSuccess(
    req,
    res,
    result,
    200,
    result.note || "Retry completed"
  );
};





/**
 * Retrieve a paginated list of posts.
 *
 * Access rules:
 * - System owners can view all posts in the system.
 * - Regular users can only view posts that belong to them.
 *
 * Supported features:
 * - Pagination with configurable limits
 * - Sorted by newest posts first
 *
 * Query parameters handled by ApiFeatures:
 * - page
 * - limit
 */

export const getAllPosts = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {

  /**
   * Ensure the request is authenticated.
   * Listing posts requires a logged-in user.
   */
  const user = req.user;

  if (!user?._id) {
    return next(new AppError("Unauthorized", 401));
  }

  /**
   * Determine the base filter depending on the user role.
   *
   * Owners can see every post in the system.
   * Regular users can only see posts they created.
   */
  const isOwner = user.role === "owner";

  const baseFilter = isOwner
    ? {}
    : { user: user._id };

  /**
   * Initialize ApiFeatures utility.
   *
   * This helper applies:
   * - pagination
   */
  const features = new ApiFeatures(
    Post.find(baseFilter),
    req.query
  )
    .paginate(10, 50);

  /**
   * Count total matching documents.
   * This must use the same filters used in the query
   * to produce correct pagination metadata.
   */
  const total = await Post.countDocuments({
    ...baseFilter,
    ...(features.filter || {}),
  });

  /**
   * Execute the query.
   *
   * Sorting:
   * - newest posts first
   *
   * Population:
   * - attach the username of the post owner
   */
  const items = await features.mongooseQuery
    .sort({ createdAt: -1 })
    .populate({
      path: "user",
      select: "username",
    });

  /**
   * Return the paginated result with metadata.
   */
  return sendSuccess(
    req,
    res,
    {
      items,
      meta: features.meta(total),
    },
    200
  );
};





/**
 * ============================================================
 * Delete Post Controller
 * ============================================================
 *
 * Deletes a post from the database.
 */



export const deletePost = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
    const postId = req.params.id;

    const post = await Post.findById(postId);

    if (!post) {
      return next(new AppError("Post not found", 404));
    }

    /**
     * Optional but recommended:
     * if the post belongs to a user, make sure the current user owns it
     */
    if (String(post.user) !== String(req.user?._id)) {
      return next(new AppError("You are not allowed to delete this post", 403));
    }

    /**
     * 1) Delete Cloudinary assets first
     * 2) Then delete post from database
     */
    await deletePostMediaFromCloudinary(post.media);

    await Post.findByIdAndDelete(postId);

    return sendSuccess(
      req,
      res,
      { id: postId },
      200,
      "Post deleted successfully"
    );
};