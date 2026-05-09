import { publishTikTokVideo } from "../../../services/tiktokPublish/tiktokPublish";
import { Platform } from "../../../types/type";
import AppError from "../../../utils/AppError";
import { failPlatform, getErrorMessage } from "../post.helper";


/**
 * Publish to TikTok only when:
 * - media is video
 * - TikTok target is selected
 * - user has an active connected TikTok account
 */
export async function publishTikTokIfNeeded(args: {
  post: any;
  targets: any;
  media: any;
  byPlatform: Map<Platform, any>;
  message: string;
  tiktokSettings?: any;
}) {
  const { post, targets, media, byPlatform, message, tiktokSettings } = args;

  /**
   * Skip if TikTok is not applicable for this post
   */
  if (!(media.kind === "video" && targets.tiktok === true && byPlatform.has("tiktok"))) return;

  post.publishResults = post.publishResults || {};

  /**
   * Ensure video URL exists (required by TikTok API)
   */
  const videoUrl = media?.video?.url;
  if (!videoUrl) {
    post.publishResults.tiktok = {
      status: "failed",
      externalId: null,
      error: "Video url is missing",
      publishedAt: null,
    };
    return;
  }

  try {
    const ttAcc: any = byPlatform.get("tiktok");

    /**
     * Ensure TikTok account has a valid access token
     */
    if (!ttAcc?.accessToken) {
      post.publishResults.tiktok = {
        status: "failed",
        externalId: null,
        error: "TikTok access token missing",
        publishedAt: null,
      };
      return;
    }

    /**
     * Privacy handling:
     * - Use provided settings if available
     * - Otherwise default to PUBLIC (no UI dependency)
     */
    const privacyLevel =
      tiktokSettings?.privacy_level || "PUBLIC_TO_EVERYONE";

    const result = await publishTikTokVideo({
      accessToken: ttAcc.accessToken,
      videoUrl,
      caption: message,
      privacy_level: privacyLevel,
      disable_comment: Boolean(tiktokSettings?.disable_comment),
      disable_duet: Boolean(tiktokSettings?.disable_duet),
      disable_stitch: Boolean(tiktokSettings?.disable_stitch),

      /**
       * Important:
       * Ensure we DO NOT force private publishing
       */
      forcePrivate: false,
    });

    /**
     * Mark success result
     */
    post.publishResults.tiktok = {
      status: "published",
      externalId: result.publish_id,
      error: null,
      publishedAt: new Date(),
    };
  } catch (e: any) {
  /**
   * Normalize error message (simple + clean)
   */
  const error = getErrorMessage(e, "TikTok publish failed");

  /**
   * Set platform result using helper (DRY)
   */
  failPlatform(post, "tiktok", error);

  /**
   * Re-throw as AppError for higher-level handling/logging
   */
  throw new AppError(
    error,
    502,
    [{ platform: "tiktok" }],
    "TIKTOK_PUBLISH_FAILED"
  );
}
}