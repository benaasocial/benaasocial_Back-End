export type Platform = "facebook" | "instagram" | "tiktok" | "youtube";


export type PostStatus =
  | "draft"
  | "queued"
  | "publishing"
  | "published"
  | "partial"
  | "failed";



export type CreatePostServiceInput = {
  userId: string;
  action: "draft" | "publish";
  caption?: string;
  hashtags?: any;
  targets?: Record<string, boolean>;
  media: any;
  tiktokSettings?: any;
  youtubeSettings?: any;
};

export type RetryPostServiceInput = {
  postId: string;
  requesterId: string;
  requesterRole: string;
  onlyPlatform?: unknown;
  tiktokSettings?: any;
  youtubeSettings?: any;
};

export type CreatePostServiceResult = {
  post: any;
  meta?: {
    publishedPlatforms: Platform[];
    failedPlatforms: Platform[];
    idlePlatforms?: Platform[];
  };
  note?: string;
};

export const ALL_PLATFORMS: Platform[] = ["facebook", "instagram", "tiktok", "youtube"];