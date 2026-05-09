import { Platform } from "../../types/type";

type PostStatus = "draft" | "queued" | "publishing" | "published" | "partial" | "failed";


/**
 * Calculates the final post status based on per-platform publish results.
 *
 * Rules:
 * - If at least one platform succeeded:
 *     - and others failed/idle -> "partial"
 *     - and all succeeded      -> "published"
 * - If none succeeded -> "failed"
 */
export function finalizeStatus(post: any): {
  status: PostStatus;
  publishedPlatforms: Platform[];
  failedPlatforms: Platform[];
  idlePlatforms: Platform[];
} {
  const results = post.publishResults || {};
  const targets = post.targets || {};

  const platforms: Platform[] = ["facebook", "instagram", "tiktok" , "youtube"];

  // Only consider platforms that were selected by the user
  const targeted = platforms.filter((p) => targets?.[p] === true);

  const publishedPlatforms: Platform[] = [];
  const failedPlatforms: Platform[] = [];
  const idlePlatforms: Platform[] = [];

  for (const p of targeted) {
    const s = results?.[p]?.status;

    if (s === "published") {
      publishedPlatforms.push(p);
    } else if (s === "failed") {
      failedPlatforms.push(p);
    } else {
      // idle or undefined
      idlePlatforms.push(p);
    }
  }

  const anyPublished = publishedPlatforms.length > 0;

  let status: PostStatus;

  if (anyPublished) {
    status =
      failedPlatforms.length > 0 || idlePlatforms.length > 0
        ? "partial"
        : "published";
  } else {
    status = "failed";
  }

  return {
    status,
    publishedPlatforms,
    failedPlatforms,
    idlePlatforms,
  };
}