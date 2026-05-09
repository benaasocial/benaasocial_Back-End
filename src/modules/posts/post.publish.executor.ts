import { Platform } from "../../types/type";
import { failPlatform, getErrorMessage, succeedPlatform } from "./post.helper";
import { getImageUrls } from "./post.publish.utils";
import { publishFacebookMultiPhotoPost, publishFacebookVideoPost } from "../../services/metaPublish/facebookPublish";
import { publishInstagramImages, publishInstagramVideo } from "../../services/metaPublish/instagramPublish";
import { publishTikTokVideo } from "../../services/tiktokPublish/tiktokPublish";
import { publishYouTubeVideo } from "../../services/youtubePublish/youtubePublish";
import { getValidTikTokAccessToken } from "./post.tiktok.token";








/**
 * =========================
 * Facebook Publishing Logic
 * =========================
 */
async function publishFacebook(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
}) {
  const { post, byPlatform, message, media } = params;

  // Skip if Facebook is not selected
  if (!byPlatform.has("facebook")) return;

  try {
    const acc: any = byPlatform.get("facebook");

    /**
     * Handle image posts
     */
    if (media.kind === "images") {
      const imageUrls = getImageUrls(media);

      if (!imageUrls.length) {
        failPlatform(post, "facebook", "No images provided for Facebook");
        return;
      }

      const result = await publishFacebookMultiPhotoPost({
        pageId: acc.accountExternalId,
        pageAccessToken: acc.accessToken,
        message,
        imageUrls,
      });

      succeedPlatform(post, "facebook", result.postId);
      return;
    }

    /**
     * Handle video posts
     */
    if (media.kind === "video") {
      const videoUrl = media?.video?.url;

      if (!videoUrl) {
        failPlatform(post, "facebook", "Video url is missing");
        return;
      }

      const result = await publishFacebookVideoPost({
        pageId: acc.accountExternalId,
        pageAccessToken: acc.accessToken,
        message,
        videoUrl,
      });

      succeedPlatform(post, "facebook", result.videoId);
      return;
    }

    /**
     * Unsupported media type
     */
    failPlatform(post, "facebook", `Unsupported media kind: ${media?.kind}`);
  } catch (e: any) {
    const providerMsg = getErrorMessage(e, "Facebook publish failed");
    failPlatform(post, "facebook", providerMsg);
  }
}

/**
 * =========================
 * Instagram Publishing Logic
 * =========================
 */
async function publishInstagram(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
}) {
  const { post, byPlatform, message, media } = params;

  // Skip if Instagram is not selected
  if (!byPlatform.has("instagram")) return;

  try {
    const acc: any = byPlatform.get("instagram");

    /**
     * Handle image posts
     */
    if (media.kind === "images") {
      const imageUrls = getImageUrls(media);

      if (!imageUrls.length) {
        failPlatform(post, "instagram", "No images provided for Instagram");
        return;
      }

      const result = await publishInstagramImages({
        igUserId: acc.accountExternalId,
        accessToken: acc.accessToken,
        caption: message,
        imageUrls,
      });

      succeedPlatform(post, "instagram", result.mediaId);
      return;
    }

    /**
     * Handle video posts
     */
    if (media.kind === "video") {
      const videoUrl = media?.video?.url;

      if (!videoUrl) {
        failPlatform(post, "instagram", "Video url is missing");
        return;
      }

      const result = await publishInstagramVideo({
        igUserId: acc.accountExternalId,
        accessToken: acc.accessToken,
        caption: message,
        videoUrl,
        shareToFeed: true,
      });

      succeedPlatform(post, "instagram", result.mediaId);
      return;
    }

    /**
     * Unsupported media type
     */
    failPlatform(post, "instagram", `Unsupported media kind: ${media?.kind}`);
  } catch (e: any) {
    const error = getErrorMessage(e, "Instagram publish failed");
    failPlatform(post, "instagram", error);
  }
}

/**
 * =========================
 * TikTok Publishing Logic
 * =========================
 */
async function publishTikTok(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
  tiktokSettings?: any;
}) {
  const { post, byPlatform, message, media, tiktokSettings } = params;

  // Skip if TikTok is not selected or media is not a video
  if (media.kind !== "video" || !byPlatform.has("tiktok")) return;

  const videoUrl = media?.video?.url;

  // Backend defaults:
  // If no settings are provided, publish publicly by default.
  const privacyLevel = tiktokSettings?.privacy_level ?? "SELF_ONLY";
  const disableComment = tiktokSettings?.disable_comment ?? false;
  const disableDuet = tiktokSettings?.disable_duet ?? false;
  const disableStitch = tiktokSettings?.disable_stitch ?? false;

  if (!videoUrl) {
    failPlatform(post, "tiktok", "Video url is missing");
    return;
  }

  try {
    const acc: any = byPlatform.get("tiktok");

    const accessToken = await getValidTikTokAccessToken({
      userId: String(post.user),
      accountId: String(acc._id),
    });

    const result = await publishTikTokVideo({
      accessToken,
      videoUrl,
      caption: message,
      privacy_level: privacyLevel,
      disable_comment: disableComment,
      disable_duet: disableDuet,
      disable_stitch: disableStitch,
      forcePrivate: false,
    });

    succeedPlatform(post, "tiktok", result.publish_id);
  } catch (e: any) {
    const error = getErrorMessage(e, "TikTok publish failed");
    failPlatform(post, "tiktok", error);
  }
}

/**
 * =========================
 * YouTube Publishing Logic
 * =========================
 */

async function publishYouTube(params: {
  post: any;
  byPlatform: Map<Platform, any>;
  message: string;
  media: any;
  youtubeSettings?: any;
}) {
  const { post, byPlatform, media, youtubeSettings } = params;

  // Skip if not applicable
  if (media.kind !== "video" || !byPlatform.has("youtube")) return;

  const videoUrl = media?.video?.url;

  if (!videoUrl) {
    failPlatform(post, "youtube", "Video url is missing");
    return;
  }

  try {
    const acc: any = byPlatform.get("youtube");

    if (!acc?.accessToken) {
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
     * Title = caption only (or fallback)
     */
    const title =
      youtubeSettings?.title?.trim() ||
      String(post.caption || "").trim().slice(0, 100) ||
      "Untitled video";

    const result = await publishYouTubeVideo({
      accessToken: acc.accessToken,
      refreshToken: acc.meta?.refreshToken,
      videoUrl,
      title,
      description: hashtagsOnly,
      privacyStatus: "public",
    });


    if (!result?.videoId) {
      failPlatform(post, "youtube", "YouTube did not return a valid video id");
      return;
    }

    succeedPlatform(post, "youtube", result.videoId);

  } catch (e: any) {
    const error = getErrorMessage(e, "YouTube publish failed");
    failPlatform(post, "youtube", error);
  }
}

/**
 * =========================
 * Main Executor
 * =========================
 *
 * Responsible for running publishing across all selected platforms.
 * Each platform handles its own validation + defaults internally.
 */
export async function executePublishing(params: {
  post: any;
  platforms: Platform[];
  byPlatform: Map<Platform, any>;
  media: any;
  message: string;
  tiktokSettings?: any;
  youtubeSettings?: any;
}) {
  const {
    post,
    platforms,
    byPlatform,
    media,
    message,
    tiktokSettings,
    youtubeSettings,
  } = params;

  /**
   * Build a filtered map of only connected platforms
   */
  const runnableMap = new Map<Platform, any>();

  for (const p of platforms) {
    if (byPlatform.has(p)) {
      runnableMap.set(p, byPlatform.get(p));
    }
  }

  /**
   * Execute publishing sequentially
   * (can be parallelized later if needed)
   */
  await publishFacebook({ post, byPlatform: runnableMap, message, media });
  await publishInstagram({ post, byPlatform: runnableMap, message, media });
  await publishTikTok({
    post,
    byPlatform: runnableMap,
    message,
    media,
    tiktokSettings,
  });
  await publishYouTube({
    post,
    byPlatform: runnableMap,
    message,
    media,
    youtubeSettings,
  });
}