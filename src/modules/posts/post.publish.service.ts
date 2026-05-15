import Post from "./model";
import AppError from "../../utils/AppError";
import {
  ALL_PLATFORMS,
  CreatePostServiceInput,
  CreatePostServiceResult,
  Platform,
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
    tiktokSettings: targets?.tiktok ? tiktokSettings : undefined,
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
function getPublishResult(post: any, platform: Platform) {
  const results = post.publishResults;

  if (!results) return null;

  if (typeof results.get === "function") {
    return results.get(platform);
  }

  return results[platform];
}

function hasFailedPlatform(post: any) {
  return ALL_PLATFORMS.some((platform) => {
    const result = getPublishResult(post, platform);
    return result?.status === "failed";
  });
}

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

  if (!requesterId) {
    throw new AppError("Unauthorized", 401);
  }

  const existing = await Post.findById(postId);

  if (!existing) {
    throw new AppError("Post not found", 404);
  }

  const isOwner = requesterRole === "owner";

  if (!isOwner && String((existing as any).user) !== String(requesterId)) {
    throw new AppError("Forbidden", 403);
  }

  if ((existing as any).action !== "publish") {
    throw new AppError("This post is not a publish action", 400);
  }

  const hasRequestedPlatform =
    onlyPlatform !== undefined &&
    onlyPlatform !== null &&
    String(onlyPlatform).trim() !== "";

  const requestedPlatform = parsePlatform(onlyPlatform);

  if (hasRequestedPlatform && !requestedPlatform) {
    throw new AppError("Invalid platform value", 400);
  }

  /**
   * Do not allow retry while the post is already publishing.
   * This prevents double retry clicks while TikTok is still processing.
   */
  if ((existing as any).status === "publishing") {
    throw new AppError(
      "Please wait. This post is still publishing.",
      409
    );
  }

  const requestedPlatformResult = requestedPlatform
    ? getPublishResult(existing, requestedPlatform)
    : null;

  const requestedPlatformStatus =
    requestedPlatformResult?.status;

  const retryablePostStatuses: PostStatus[] = [
    "failed",
    "partial",
    "queued",
  ];

  const canRetryBecausePostStatus =
    retryablePostStatuses.includes((existing as any).status);

  const canRetryBecauseRequestedPlatformFailed =
    requestedPlatformStatus === "failed";

  const canRetryBecauseAnyPlatformFailed =
    !requestedPlatform && hasFailedPlatform(existing);

  if (
    !canRetryBecausePostStatus &&
    !canRetryBecauseRequestedPlatformFailed &&
    !canRetryBecauseAnyPlatformFailed
  ) {
    throw new AppError(
      "This post cannot be retried unless the post or selected platform has failed",
      400
    );
  }

  const locked = await Post.findOneAndUpdate(
    {
      _id: postId,
      status: { $ne: "publishing" },
    },
    {
      $set: {
        status: "publishing",
      },
    },
    {
      returnDocument: "after",
    }
  );

  if (!locked) {
    throw new AppError(
      "Please wait. This post is still publishing.",
      409
    );
  }

  const post: any = locked;

  ensurePublishResults(post);
  ensureValidMedia(post.media);

  const media = post.media;
  const targets = post.targets || {};

  const targeted = ALL_PLATFORMS.filter(
    (p) => targets?.[p] === true
  );

  if (targeted.length === 0) {
    return await saveFinalized(
      post,
      "No platforms selected for this post."
    );
  }

  if (requestedPlatform && !targeted.includes(requestedPlatform)) {
    return await saveFinalized(
      post,
      `Platform "${requestedPlatform}" was not selected for this post.`
    );
  }

  let candidates = targeted
    .filter((p) => isPlatformCompatible(p, media.kind))
    .filter((p) => shouldRetryPlatform(post, p));

  if (requestedPlatform) {
    candidates = candidates.filter(
      (p) => p === requestedPlatform
    );
  }

  if (candidates.length === 0) {
    return await saveFinalized(
      post,
      requestedPlatform
        ? `Nothing to retry for platform "${requestedPlatform}".`
        : "Nothing to retry for the selected platform(s)."
    );
  }

  const byPlatform = await loadActiveAccounts(
    String(post.user),
    candidates
  );

  for (const p of candidates) {
    setPlatformResult(post, p, {
      status: byPlatform.has(p) ? "idle" : "failed",
      externalId: null,
      error: byPlatform.has(p)
        ? null
        : "Platform not connected/active",
      publishedAt: null,
      rawStatus: null,
    });
  }

  const runnable = candidates.filter((p) =>
    byPlatform.has(p)
  );

  if (runnable.length === 0) {
    return await saveFinalized(
      post,
      requestedPlatform
        ? `No active connected account for platform "${requestedPlatform}".`
        : "No active connected accounts for retry platforms."
    );
  }

  const message = buildMessage(
    String(post.caption || ""),
    asStringArray(post.hashtags || [])
  );

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