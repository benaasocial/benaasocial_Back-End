import { publishYouTubeVideo } from "../../../services/youtubePublish/youtubePublish";
import { failPlatform, getErrorMessage, succeedPlatform } from "../post.helper";

type Params = {
  post: any;
  targets: Record<string, boolean>;
  media: any;
  byPlatform: Map<any, any>;
  message: string;
  youtubeSettings?: {
    title?: string;
    description?: string;
    privacyStatus?: "private" | "public" | "unlisted";
  };
};

export const publishYouTubeIfNeeded = async ({
  post,
  targets,
  media,
  byPlatform,
  message,
  youtubeSettings,
}: Params) => {
  /**
   * Skip if YouTube is not applicable
   */
  if (!targets?.youtube) return;
  if (media?.kind !== "video") return;
  if (!byPlatform.has("youtube")) return;

  try {
    const ytAcc: any = byPlatform.get("youtube");

    /**
     * Validate access token
     */
    if (!ytAcc?.accessToken) {
      failPlatform(post, "youtube", "YouTube access token missing");
      return;
    }

    /**
     * Build hashtags-only description
     */
    const hashtagsOnly = Array.isArray(post.hashtags)
      ? post.hashtags
          .map((tag: string) => (tag.startsWith("#") ? tag : `#${tag}`))
          .join(" ")
      : "";

    /**
     * Title = caption only
     */
    const title =
      youtubeSettings?.title?.trim() ||
      String(post.caption || "").trim().slice(0, 100) ||
      "Untitled video";

    const result = await publishYouTubeVideo({
      accessToken: ytAcc.accessToken,
      refreshToken: ytAcc.meta?.refreshToken,
      tokenExpiresAt: ytAcc.tokenExpiresAt,
      videoUrl: media.video.url,
      title,
      description: hashtagsOnly,
      privacyStatus: "public",
    });

    /**
     * Validate response before success
     */
    if (!result?.videoId) {
      failPlatform(post, "youtube", "YouTube did not return a valid video id");
      return;
    }

    succeedPlatform(post, "youtube", result.videoId);
  } catch (e: any) {
    const error = getErrorMessage(e, "YouTube publish failed");
    failPlatform(post, "youtube", error);
  }
};