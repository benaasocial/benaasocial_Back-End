import { Platform } from "../../types/type";

type PostStatus =
  | "draft"
  | "queued"
  | "publishing"
  | "published"
  | "partial"
  | "failed";

export function finalizeStatus(post: any): {
  status: PostStatus;
  publishedPlatforms: Platform[];
  failedPlatforms: Platform[];
  idlePlatforms: Platform[];
} {
  const results = post.publishResults || {};
  const targets = post.targets || {};

  const platforms: Platform[] = [
    "facebook",
    "instagram",
    "tiktok",
    "youtube",
  ];

  const targeted = platforms.filter(
    (p) => targets?.[p] === true
  );

  const publishedPlatforms: Platform[] = [];
  const failedPlatforms: Platform[] = [];
  const idlePlatforms: Platform[] = [];
  const processingPlatforms: Platform[] = [];

  for (const p of targeted) {
    const s = results?.[p]?.status;

    if (s === "published") {
      publishedPlatforms.push(p);
    } else if (s === "failed") {
      failedPlatforms.push(p);
    } else if (s === "processing") {
      processingPlatforms.push(p);
    } else {
      idlePlatforms.push(p);
    }
  }

  let status: PostStatus;

  if (processingPlatforms.length > 0) {
    status =
      publishedPlatforms.length > 0 || failedPlatforms.length > 0
        ? "partial"
        : "publishing";
  } else if (
    targeted.length > 0 &&
    publishedPlatforms.length === targeted.length
  ) {
    status = "published";
  } else if (publishedPlatforms.length > 0) {
    status = "partial";
  } else {
    status = "failed";
  }

  post.status = status;

  return {
    status,
    publishedPlatforms,
    failedPlatforms,
    idlePlatforms,
  };
}