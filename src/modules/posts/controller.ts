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
import { ConnectedAccount } from "../integrations/ConnectedAccount";
import { getValidTikTokAccessToken } from "./post.tiktok.token";
import { getTikTokCreatorInfo } from "../../services/tiktokPublish/tiktokCreatorInfo";
import { fetchTikTokPublishStatus } from "../../services/tiktokPublish/tiktokPublishStatus";
import { finalizeStatus } from "./post.status";

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
 * Fetch TikTok creator information for the currently connected account.
 *
 * Used by the frontend to:
 * - Display TikTok account details
 * - Load dynamic privacy options
 * - Load interaction permissions (comments, duet, stitch)
 * - Validate TikTok publishing capabilities
 */
export const getTikTokCreatorInfoController = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {

  /**
   * Ensure authenticated user exists
   */
  const userId = req.user?._id;

  if (!userId) {
    return next(new AppError("Unauthorized", 401));
  }

  /**
   * Find active connected TikTok account
   */
  const account = await ConnectedAccount.findOne({
    userId: userId,
    platform: "tiktok",
    isActive: true,
  });

  if (!account) {
    return next(new AppError("TikTok account is not connected", 404));
  }

  /**
   * Ensure access token is valid
   */
  const accessToken = await getValidTikTokAccessToken({
    userId: String(userId),
    accountId: String(account._id),
  });

  /**
   * Fetch creator info directly from TikTok API
   */
  const creatorInfo = await getTikTokCreatorInfo(accessToken);

  return sendSuccess(
    req,
    res,
    creatorInfo,
    200,
    "TikTok creator info fetched successfully"
  );
};

/**
 * Fetch the latest TikTok publishing status for a post.
 *
 * Why this exists:
 * - TikTok publishing is asynchronous
 * - Upload success does NOT guarantee final publish success
 * - TikTok may still process or reject the video later
 *
 * This endpoint synchronizes the local publish state
 * with TikTok's latest processing result.
 */
function getTikTokFailureReason(tiktokStatus: any) {
  return (
    tiktokStatus?.fail_reason ||
    tiktokStatus?.error?.message ||
    tiktokStatus?.error?.code ||
    tiktokStatus?.status_message ||
    tiktokStatus?.message ||
    "TikTok processing failed"
  );
}

export const getTikTokPostStatus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const userId = req.user?._id;
  const postId = req.params.id;

  if (!userId) {
    return next(new AppError("Unauthorized", 401));
  }

  const post = await Post.findOne({
    _id: postId,
    user: userId,
  });

  if (!post) {
    return next(new AppError("Post not found", 404));
  }

  const publishId = post.publishResults?.tiktok?.externalId;

  if (!publishId) {
    return next(new AppError("TikTok publish id not found", 400));
  }

  const account = await ConnectedAccount.findOne({
    userId,
    platform: "tiktok",
  });

  if (!account) {
    return next(new AppError("TikTok account is not connected", 404));
  }

  const accessToken = await getValidTikTokAccessToken({
    userId: String(userId),
    accountId: String(account._id),
  });

  const tiktokStatus = await fetchTikTokPublishStatus({
    accessToken,
    publishId,
  });

  const status = tiktokStatus?.status;

  post.publishResults = post.publishResults || {};
  post.publishResults.tiktok = post.publishResults.tiktok || {};

  if (status === "PUBLISH_COMPLETE") {
    post.publishResults.tiktok.status = "published";
    post.publishResults.tiktok.error = null;
    post.publishResults.tiktok.publishedAt = new Date();
  } else if (
    status === "FAILED" ||
    status === "PUBLISH_FAILED" ||
    status === "PROCESSING_UPLOAD_FAILED"
  ) {
    post.publishResults.tiktok.status = "failed";
    post.publishResults.tiktok.error = getTikTokFailureReason(tiktokStatus);
    post.publishResults.tiktok.publishedAt = null;
  } else {
    post.publishResults.tiktok.status = "processing";
  }

  post.publishResults.tiktok.rawStatus = tiktokStatus;

  finalizeStatus(post);

  await post.save();


  return sendSuccess(
    req,
    res,
    {
      post,
      tiktokStatus,
    },
    200,
    "TikTok publish status fetched successfully"
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