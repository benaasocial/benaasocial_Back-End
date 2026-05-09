import AppError from "../../utils/AppError";
import { CreatePostServiceResult } from "../../types/type";
import { extractImageUrls } from "./post.helper";
import { finalizeStatus } from "./post.status";

/**
 * Validate that the post media is supported.
 * Only "images" and "video" are allowed in the publishing flow.
 */
export function ensureValidMedia(media: any) {
  if (!media || (media.kind !== "images" && media.kind !== "video")) {
    throw new AppError("Unsupported media type", 400);
  }
}

/**
 * Make sure the post always has a publishResults object
 * before platform publishing starts.
 */
export function ensurePublishResults(post: any) {
  post.publishResults = post.publishResults || {};
}

/**
 * Finalize the post status in memory and return
 * a normalized service response object.
 *
 * This does not save to the database by itself.
 */
export function finalizeAndReturn(
  post: any,
  note?: string
): CreatePostServiceResult {
  const fin = finalizeStatus(post);
  post.status = fin.status;

  return {
    post,
    note,
    meta: {
      publishedPlatforms: fin.publishedPlatforms,
      failedPlatforms: fin.failedPlatforms,
      idlePlatforms: fin.idlePlatforms,
    },
  };
}

/**
 * Finalize the post status, persist changes,
 * and return the service result.
 */
export async function saveFinalized(
  post: any,
  note?: string
): Promise<CreatePostServiceResult> {
  const result = finalizeAndReturn(post, note);
  await post.save();
  return result;
}

/**
 * Extract image URLs only when the media type is "images".
 * Returns an empty array for non-image posts.
 */
export function getImageUrls(media: any) {
  return media.kind === "images" ? extractImageUrls(media) : [];
}