import { CreatePostServiceResult, Platform } from "../../types/type";
import AppError from "../../utils/AppError";
import { finalizeStatus } from "./post.status";








/**
 * Builds the final post message.
 * - Adds "#" to hashtags if missing
 * - Joins caption and hashtags with spacing
 */
export function buildMessage(caption: string, hashtags: string[]) {
  // Ensure every hashtag starts with "#"
  const tags = (hashtags ?? [])
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .join(" ");

  // Combine caption + hashtags
  // Adds a blank line between them if both exist
  return [caption?.trim(), tags]
    .filter(Boolean) // remove empty values
    .join("\n\n");
}



/**
 * Safely converts any value to an array of strings.
 * - If input is not an array → return empty array
 * - Removes empty/falsy values
 * - Forces all items to be strings
 */
export function asStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];

  return v
    .filter(Boolean) // remove null/undefined/""/0/false
    .map(String);    // convert everything to string
}


/**
 * Reads the targets object and returns the platforms that are set to true.
 * Example:
 * { facebook: true, instagram: false, tiktok: true } -> ["facebook", "tiktok"]
 */
export function getSelectedPlatforms(targets: any): Platform[] {
  return (Object.entries(targets || {}) as Array<[Platform, boolean]>)
    .filter(([_, v]) => v === true) // only keep explicitly selected platforms  --    [ [ "facebook", true ], [ "tiktok", true ] ]
    .map(([k]) => k);               // return platform names  --    [ "facebook", "tiktok" ]
}




/**
 * Checks if a platform supports the current media type.
 * - Facebook/Instagram: images and video
 * - TikTok: video only
 * - YouTube: video only
 * - X: images and video
 */
export function isPlatformCompatible(
  p: Platform,
  mediaKind: "images" | "video"
) {
  const compatibility: Record<Platform, Array<"images" | "video">> = {
    facebook: ["images", "video"],
    instagram: ["images", "video"],
    tiktok: ["video"],
    youtube: ["video"],
  };

  return compatibility[p]?.includes(mediaKind) ?? false;
}


/**
 * Marks selected platforms as failed if they can't handle the current media kind.
 * This keeps publishResults consistent even before we try publishing.
 */
export function markIncompatiblePlatforms(
  post: any,
  selected: Platform[],
  mediaKind: "images" | "video"
) {
  // Ensure object exists (safety)
  post.publishResults = post.publishResults || {};

  for (const p of selected) {

    // Skip platforms that are compatible
    // - Facebook/Instagram: images only
    // - TikTok/YouTube: video only
    if (isPlatformCompatible(p, mediaKind)) continue;

    post.publishResults[p] = {
      status: "failed",
      externalId: null,
      error:
        p === "tiktok"
          ? "This platform requires a video"
          : "This platform currently supports images only",
      publishedAt: null,
    };
  }
}





/**
 * Extracts image URLs from the media object.
 * Returns a clean list of non-empty URLs.
 */
export function extractImageUrls(media: any): string[] {
  const imgs = Array.isArray(media?.images) ? media.images : [];

  return imgs
    .map((img: any) => String(img?.url || "").trim())
    .filter(Boolean);
}






export function shouldRetryPlatform(post: any, p: Platform) {
  const r = post?.publishResults?.[p];
  if (r?.status === "published") return false;
  return r?.status === "failed" || r?.status === "idle" || !r?.status;
}


const PLATFORM_VALUES: Platform[] = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
];


export function parsePlatform(value: unknown): Platform | null {
  if (Array.isArray(value)) {
    value = value[0];
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return PLATFORM_VALUES.includes(normalized as Platform)
    ? (normalized as Platform)
    : null;
}



/**
 * Updates/initializes the publish result for a given platform.
 *
 * Why this helper exists:
 * - Ensures publishResults object always exists
 * - Ensures each platform result has a consistent shape
 * - Allows partial updates without losing existing data
 */
export function setPlatformResult(
  post: any,
  platform: Platform,
  patch: {
    status?: "idle" | "failed" | "published";
    externalId?: string | null;
    error?: string | null;
    publishedAt?: Date | null;
  }
) {
  post.publishResults = post.publishResults || {};
  const prev = post.publishResults[platform] || {};

  post.publishResults[platform] = {
    status: patch.status ?? prev.status ?? "idle",
    externalId: patch.externalId ?? prev.externalId ?? null,
    error: patch.error ?? prev.error ?? null,
    publishedAt: patch.publishedAt ?? prev.publishedAt ?? null,
  };
}




export function ensureValidMedia(media: any) {
  if (!media || (media.kind !== "images" && media.kind !== "video")) {
    throw new AppError("Unsupported media type", 400);
  }
}

export function ensurePublishResults(post: any) {
  post.publishResults = post.publishResults || {};
}

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

export async function saveFinalized(
  post: any,
  note?: string
): Promise<CreatePostServiceResult> {
  const result = finalizeAndReturn(post, note);
  await post.save();
  return result;
}

export function getInstagramSafeUrls(media: any): string[] {
  const images = Array.isArray(media?.images) ? media.images : [];

  return images
    .map((img: any) => {
      const url = typeof img === "string" ? img : img?.url;
      if (!url || typeof url !== "string") return null;

      return url.replace(
        "/upload/",
        "/upload/w_1080,h_1350,c_pad,b_auto/"
      );
    })
    .filter(Boolean) as string[];
}



export function failPlatform(post: any, platform: Platform, error: string) {
  setPlatformResult(post, platform, {
    status: "failed",
    externalId: null,
    error,
    publishedAt: null,
  });
}

export function succeedPlatform(post: any, platform: Platform, externalId: string) {
  setPlatformResult(post, platform, {
    status: "published",
    externalId,
    error: null,
    publishedAt: new Date(),
  });
}


export function getErrorMessage(e: any, fallback: string) {
  return (
    e?.response?.data?.error?.message ||
    e?.response?.data?.message ||
    e?.message ||
    fallback
  );
}