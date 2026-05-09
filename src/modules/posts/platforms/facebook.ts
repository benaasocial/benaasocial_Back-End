import {
  publishFacebookMultiPhotoPost,
  publishFacebookVideoPost,
} from "../../../services/metaPublish/facebookPublish";
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
 * Publish to Facebook only when:
 * - facebook target is selected
 * - user has an active connected Facebook account
 * - media kind is supported (images | video)
 */
export async function publishFacebookIfNeeded(args: {
  post: any;
  targets: any;
  media: any;
  byPlatform: Map<Platform, any>;
  message: string;
  imageUrls: string[];
}) {
  const { post, targets, media, byPlatform, message, imageUrls } = args;

  // Not applicable for this post
  if (!(targets?.facebook === true && byPlatform.has("facebook"))) return;

  // Ensure publishResults exists
  post.publishResults = post.publishResults || {};

  try {
    // get connected Facebook account
    const fbAcc: any = byPlatform.get("facebook");

    if (!fbAcc?.accountExternalId || !fbAcc?.accessToken) {
      post.publishResults.facebook = {
        status: "failed",
        externalId: null,
        error: "Facebook account is not properly connected",
        publishedAt: null,
      };

      throw new AppError(
        "Facebook account is not properly connected",
        400,
        [{ platform: "facebook", hasAccountExternalId: !!fbAcc?.accountExternalId, hasAccessToken: !!fbAcc?.accessToken }],
        "FACEBOOK_ACCOUNT_INVALID"
      );
    }

    /**
     * Images flow
     */
    if (media?.kind === "images") {
      if (!imageUrls?.length) {
        post.publishResults.facebook = {
          status: "failed",
          externalId: null,
          error: "No images provided for Facebook",
          publishedAt: null,
        };
        return;
      }

      const fb = await publishFacebookMultiPhotoPost({
        pageId: fbAcc.accountExternalId,
        pageAccessToken: fbAcc.accessToken,
        message,
        imageUrls,
      });

      post.publishResults.facebook = {
        status: "published",
        externalId: fb.postId,
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
        post.publishResults.facebook = {
          status: "failed",
          externalId: null,
          error: "No video URL provided for Facebook",
          publishedAt: null,
        };
        return;
      }

      const fb = await publishFacebookVideoPost({
        pageId: fbAcc.accountExternalId,
        pageAccessToken: fbAcc.accessToken,
        message,
        videoUrl,
      });

      post.publishResults.facebook = {
        status: "published",
        externalId: fb.videoId,
        error: null,
        publishedAt: new Date(),
      };

      return;
    }

    /**
     * Unsupported media kind
     */
    post.publishResults.facebook = {
      status: "failed",
      externalId: null,
      error: `Unsupported Facebook media kind: ${media?.kind}`,
      publishedAt: null,
    };

    return;
  } catch (e: any) {
  const providerMsg = getErrorMessage(e, "Facebook publish failed");
  failPlatform(post, "facebook", providerMsg);

  throw new AppError(
    providerMsg,
    502,
    [
      {
        platform: "facebook",
        mediaKind: media?.kind,
        providerStatus: e?.response?.status,
      },
    ],
    "FACEBOOK_PUBLISH_FAILED"
  );
}
}