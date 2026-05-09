import Post from "./model";
import AppError from "../../utils/AppError";
import {
  ALL_PLATFORMS,
  CreatePostServiceInput,
  CreatePostServiceResult,
  PostStatus,
  RetryPostServiceInput,
} from "../../types/type";

import {
  asStringArray,
  buildMessage,
  getSelectedPlatforms,
  isPlatformCompatible,
  markIncompatiblePlatforms,
  parsePlatform,
  setPlatformResult,
  shouldRetryPlatform,
} from "./post.helper";

import { loadActiveAccounts, markMissingAccounts } from "./post.accounts";
import { finalizeStatus } from "./post.status";
import {
  ensurePublishResults,
  ensureValidMedia,
  saveFinalized,
} from "./post.publish.utils";
import { executePublishing } from "./post.publish.executor";

/**
 * =========================
 * CREATE + PUBLISH FLOW
 * =========================
 *
 * Handles:
 * - Draft creation
 * - Immediate publishing
 */
export async function publishPost(
  input: CreatePostServiceInput
): Promise<CreatePostServiceResult> {
  const {
    userId,
    action,
    caption = "",
    hashtags = [],
    targets = {},
    media,
    tiktokSettings,
    youtubeSettings,
  } = input;

  /**
   * Ensure user is authenticated
   */
  if (!userId) throw new AppError("Unauthorized", 401);

  /**
   * Validate media type (images / video only)
   */
  ensureValidMedia(media);

  /**
   * Normalize hashtags and build final message
   */
  const hashtagsArr = asStringArray(hashtags);
  const message = buildMessage(String(caption || ""), hashtagsArr);

  /**
   * Create post in DB
   * - draft → stays draft
   * - publish → starts as queued
   */
  const post = await Post.create({
    user: userId,
    action,
    status: action === "draft" ? "draft" : "queued",
    caption,
    hashtags: hashtagsArr,
    targets,
    media,
  });

  // create publish results
  ensurePublishResults(post);

  /**
   * If draft → no publishing
   */
  if (action === "draft") {
    return { post };
  }

  /**
   * Extract selected platforms
   */
  const selected = getSelectedPlatforms(targets);   // return platform names  --    [ "facebook", "tiktok" ]

  if (selected.length === 0) {
    post.status = "queued";
    await post.save();

    return {
      post,
      note: "No platforms selected. Post saved without external publishing.",
    };
  }

  /**
   * Mark platforms that are incompatible with media type
   */
  markIncompatiblePlatforms(post, selected, media.kind);

  /**
   * Keep only compatible platforms
   */
  const compatibleSelected = selected.filter((p) =>
    isPlatformCompatible(p, media.kind)
  );

  if (compatibleSelected.length === 0) {
    post.status = "failed";
    await post.save();

    return {
      post,
      note: "Selected platforms are incompatible with the media type.",
    };
  }

  /**
   * Load connected accounts for selected platforms
   */
  const byPlatform = await loadActiveAccounts(String(userId), compatibleSelected);

  /**
   * Mark missing / disconnected platforms
   */
  const missing = compatibleSelected.filter((p) => !byPlatform.has(p));
  markMissingAccounts(post, missing);

  /**
   * If no platform is connected → fail early
   */
  if (missing.length === compatibleSelected.length) {
    post.status = "failed";
    await post.save();

    return {
      post,
      note: "Selected platforms are not connected/active. Nothing was published.",
    };
  }

  /**
   * Move post to publishing state
   */
  post.status = "publishing";
  await post.save();

  /**
   * Execute publishing across platforms
   */
  await executePublishing({
    post,
    platforms: compatibleSelected,
    byPlatform,
    media,
    message,
    tiktokSettings,
    youtubeSettings,
  });

  /**
   * Finalize status + persist result
   */
  return await saveFinalized(post);
}

/**
 * =========================
 * RETRY FLOW
 * =========================
 *
 * Handles retrying failed / partial posts.
 */
export async function retryPostPublishing(
  input: RetryPostServiceInput
): Promise<CreatePostServiceResult> {
  const {
    postId,
    requesterId,
    requesterRole,
    onlyPlatform,
    tiktokSettings,
    youtubeSettings,
  } = input;

  /**
   * Auth check
   */
  if (!requesterId) {
    throw new AppError("Unauthorized", 401);
  }

  /**
   * Load post
   */
  const existing = await Post.findById(postId);
  if (!existing) {
    throw new AppError("Post not found", 404);
  }

  /**
   * Permission check:
   * - owner can retry anything
   * - otherwise must be post owner
   */
  const isOwner = requesterRole === "owner";
  if (!isOwner && String((existing as any).user) !== String(requesterId)) {
    throw new AppError("Forbidden", 403);
  }

  /**
   * Retry allowed only for publish actions
   */
  if ((existing as any).action !== "publish") {
    throw new AppError("This post is not a publish action", 400);
  }

  /**
   * Retry allowed only for specific statuses
   */
  const retryablePostStatuses: PostStatus[] = ["failed", "partial", "queued"];
  if (!retryablePostStatuses.includes(existing.status)) {
    throw new AppError(
      "This post cannot be retried unless its status is queued, partial, or failed",
      400
    );
  }

  /**
   * Lock the post to prevent concurrent publishing
   */
  const locked = await Post.findOneAndUpdate(
    { _id: postId, status: { $ne: "publishing" } },
    { $set: { status: "publishing" } },
    { new: true }
  );

  if (!locked) {
    throw new AppError("Post is currently publishing", 409);
  }

  const post: any = locked;

  ensurePublishResults(post);
  ensureValidMedia(post.media);

  const media = post.media;
  const targets = post.targets || {};

  /**
   * Optional: retry only a specific platform
   */
  const hasRequestedPlatform =
    onlyPlatform !== undefined &&
    onlyPlatform !== null &&
    String(onlyPlatform).trim() !== "";

  const requestedPlatform = parsePlatform(onlyPlatform);

  if (hasRequestedPlatform && !requestedPlatform) {
    throw new AppError("Invalid platform value", 400);
  }

  /**
   * Get originally selected platforms
   */
  const targeted = ALL_PLATFORMS.filter((p) => targets?.[p] === true);

  if (targeted.length === 0) {
    return await saveFinalized(post, "No platforms selected for this post.");
  }

  /**
   * Validate requested platform is part of the original targets
   */
  if (requestedPlatform && !targeted.includes(requestedPlatform)) {
    return await saveFinalized(
      post,
      `Platform "${requestedPlatform}" was not selected for this post.`
    );
  }

  /**
   * Build retry candidates:
   * - compatible with media
   * - failed / retryable
   */
  let candidates = targeted
    .filter((p) => isPlatformCompatible(p, media.kind))
    .filter((p) => shouldRetryPlatform(post, p));

  if (requestedPlatform) {
    candidates = candidates.filter((p) => p === requestedPlatform);
  }

  if (candidates.length === 0) {
    return await saveFinalized(
      post,
      requestedPlatform
        ? `Nothing to retry for platform "${requestedPlatform}".`
        : "Nothing to retry for the selected platform(s)."
    );
  }

  /**
   * Load active accounts for retry
   */
  const byPlatform = await loadActiveAccounts(String(post.user), candidates);

  /**
   * Reset platform results before retry
   */
  for (const p of candidates) {
    setPlatformResult(post, p, {
      status: byPlatform.has(p) ? "idle" : "failed",
      externalId: null,
      error: byPlatform.has(p) ? null : "Platform not connected/active",
      publishedAt: null,
    });
  }

  /**
   * Only retry platforms that are actually connected
   */
  const runnable = candidates.filter((p) => byPlatform.has(p));

  if (runnable.length === 0) {
    return await saveFinalized(
      post,
      requestedPlatform
        ? `No active connected account for platform "${requestedPlatform}".`
        : "No active connected accounts for retry platforms."
    );
  }

  /**
   * Build message again from caption + hashtags
   */
  const message = buildMessage(
    String(post.caption || ""),
    asStringArray(post.hashtags || [])
  );

  /**
   * Execute retry publishing
   */
  await executePublishing({
    post,
    platforms: runnable,
    byPlatform,
    media,
    message,
    tiktokSettings,
    youtubeSettings,
  });

  return await saveFinalized(post);
}