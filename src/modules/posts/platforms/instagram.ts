import {
  publishInstagramImages,
  publishInstagramVideo,
} from "../../../services/metaPublish/instagramPublish";
import { Platform } from "../../../types/type";
import AppError from "../../../utils/AppError";
import { failPlatform, getErrorMessage } from "../post.helper";


/**
 * Extract video URL safely from media object
 */
function extractVideoUrl(media: any): string | null {
  if (!media) return null;

  if (typeof media.video === "string") return media.video;
  if (media.video?.url && typeof media.video.url === "string") return media.video.url;
  if (typeof media.url === "string") return media.url;

  return null;
}

/**
 * Publish to Instagram only when:
 * - instagram target is selected
 * - user has an active connected Instagram account
 * - media kind is supported (images | video)
 */
export async function publishInstagramIfNeeded(args: {
  post: any;
  targets: any;
  media: any;
  byPlatform: Map<Platform, any>;
  message: string;
  imageUrls: string[];
}) {
  const { post, targets, media, byPlatform, message, imageUrls } = args;

  // Not applicable for this post
  if (!(targets?.instagram === true && byPlatform.has("instagram"))) return;

  post.publishResults = post.publishResults || {};

  try {
    const igAcc: any = byPlatform.get("instagram");

    if (!igAcc?.accountExternalId || !igAcc?.accessToken) {
      post.publishResults.instagram = {
        status: "failed",
        externalId: null,
        error: "Instagram account is not properly connected",
        publishedAt: null,
      };

      throw new AppError(
        "Instagram account is not properly connected",
        400,
        [
          {
            platform: "instagram",
            hasAccountExternalId: !!igAcc?.accountExternalId,
            hasAccessToken: !!igAcc?.accessToken,
          },
        ],
        "INSTAGRAM_ACCOUNT_INVALID"
      );
    }

    /**
     * Images flow
     */
    if (media?.kind === "images") {
      if (!imageUrls?.length) {
        post.publishResults.instagram = {
          status: "failed",
          externalId: null,
          error: "No images provided for Instagram",
          publishedAt: null,
        };
        return;
      }

      const ig = await publishInstagramImages({
        igUserId: igAcc.accountExternalId,
        accessToken: igAcc.accessToken,
        caption: message,
        imageUrls,
      });

      post.publishResults.instagram = {
        status: "published",
        externalId: ig.mediaId,
        error: null,
        publishedAt: new Date(),
      };

      return;
    }

    /**
     * Video flow
     */
    if (media?.kind === "video") {
      const videoUrl = extractVideoUrl(media);

      if (!videoUrl) {
        post.publishResults.instagram = {
          status: "failed",
          externalId: null,
          error: "No video URL provided for Instagram",
          publishedAt: null,
        };
        return;
      }

      const ig = await publishInstagramVideo({
        igUserId: igAcc.accountExternalId,
        accessToken: igAcc.accessToken,
        caption: message,
        videoUrl,
        shareToFeed: true,
      });

      post.publishResults.instagram = {
        status: "published",
        externalId: ig.mediaId,
        error: null,
        publishedAt: new Date(),
      };

      return;
    }

    /**
     * Unsupported media kind
     */
    post.publishResults.instagram = {
      status: "failed",
      externalId: null,
      error: `Unsupported Instagram media kind: ${media?.kind}`,
      publishedAt: null,
    };

    return;
  } catch (e: any) {
    const error = getErrorMessage(e, "Instagram publish failed");
    failPlatform(post, "instagram", error);

    throw new AppError(
      error,
      502,
      [{ platform: "instagram", mediaKind: media?.kind }],
      "INSTAGRAM_PUBLISH_FAILED"
    );
  }
}