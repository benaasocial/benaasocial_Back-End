import axios from "axios";
import AppError from "../../utils/AppError";

const IG_API = "https://graph.facebook.com/v24.0";

function normalizeForIg(url: string) {
  if (!url) return url;

  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace(
      "/upload/",
      "/upload/w_1080,h_1350,c_pad,b_auto,q_auto:best,f_jpg/"
    );
  }

  return url;
}

function safeUrlHint(url?: string) {
  if (!url) return undefined;

  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

function getFbError(e: any) {
  return {
    status: e?.response?.status,
    error: e?.response?.data?.error,
    message:
      e?.response?.data?.error?.message ||
      e?.response?.data?.message ||
      e?.message ||
      "Instagram request failed",
    raw: e?.response?.data,
  };
}

function fail(
  message: string,
  code: string,
  status = 400,
  details: Record<string, any> = {}
): never {
  throw new AppError(message, status, [details], code);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createMediaContainer(params: {
  igUserId: string;
  accessToken: string;
  imageUrl?: string;
  videoUrl?: string;
  caption?: string;
  isCarouselItem?: boolean;
  mediaType?: "IMAGE" | "VIDEO" | "REELS" | "CAROUSEL";
  children?: string[];
  shareToFeed?: boolean;
}) {
  const {
    igUserId,
    accessToken,
    imageUrl,
    videoUrl,
    caption,
    isCarouselItem,
    mediaType,
    children,
    shareToFeed,
  } = params;

  try {
    const { data } = await axios.post(`${IG_API}/${igUserId}/media`, null, {
      params: {
        image_url: imageUrl,
        video_url: videoUrl,
        caption,
        is_carousel_item: isCarouselItem || undefined,
        media_type: mediaType,
        children: children?.join(","),
        share_to_feed: shareToFeed,
        access_token: accessToken,
      },
      timeout: 60000,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    if (!data?.id) {
      fail("Instagram returned invalid container response", "IG_CONTAINER_INVALID", 502, {
        igUserId,
        imageUrlHint: safeUrlHint(imageUrl),
        videoUrlHint: safeUrlHint(videoUrl),
        response: data,
      });
    }

    return data.id as string;
  } catch (e: any) {
    const err = getFbError(e);

    fail("Failed to create Instagram media container", "IG_CONTAINER_CREATE_FAILED", err.status || 502, {
      igUserId,
      imageUrlHint: safeUrlHint(imageUrl),
      videoUrlHint: safeUrlHint(videoUrl),
      mediaType,
      childrenCount: children?.length || 0,
      fbError: err.error,
      errorMessage: err.message,
      response: err.raw,
    });
  }
}

async function waitUntilReady(params: {
  creationId: string;
  accessToken: string;
  maxAttempts?: number;
  delayMs?: number;
}) {
  const {
    creationId,
    accessToken,
    maxAttempts = 30,
    delayMs = 3000,
  } = params;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { data } = await axios.get(`${IG_API}/${creationId}`, {
        params: {
          fields: "status_code,status",
          access_token: accessToken,
        },
        timeout: 30000,
        validateStatus: (s) => s >= 200 && s < 300,
      });

      const status = data?.status_code || data?.status;

      if (["FINISHED", "READY", "PUBLISHED"].includes(status)) {
        return;
      }

      if (["ERROR", "EXPIRED"].includes(status)) {
        fail("Instagram media processing failed", "IG_CONTAINER_PROCESSING_FAILED", 502, {
          creationId,
          attempt,
          response: data,
        });
      }
    } catch (e: any) {
      const err = getFbError(e);

      if (err.status && err.status < 500 && err.status !== 429 && err.status !== 408) {
        fail("Failed while checking Instagram container status", "IG_CONTAINER_STATUS_FAILED", err.status, {
          creationId,
          attempt,
          fbError: err.error,
          errorMessage: err.message,
          response: err.raw,
        });
      }
    }

    await sleep(delayMs);
  }

  fail("Instagram media processing timed out", "IG_CONTAINER_PROCESSING_TIMEOUT", 504, {
    creationId,
    maxAttempts,
  });
}

async function publishContainer(params: {
  igUserId: string;
  accessToken: string;
  creationId: string;
  retries?: number;
}) {
  const { igUserId, accessToken, creationId, retries = 2 } = params;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const { data } = await axios.post(
        `${IG_API}/${igUserId}/media_publish`,
        null,
        {
          params: {
            creation_id: creationId,
            access_token: accessToken,
          },
          timeout: 30000,
          validateStatus: (s) => s >= 200 && s < 300,
        }
      );

      if (!data?.id) {
        fail("Instagram returned invalid publish response", "IG_PUBLISH_INVALID", 502, {
          igUserId,
          creationId,
          response: data,
        });
      }

      return data.id as string;
    } catch (e: any) {
      const err = getFbError(e);

      if (attempt <= retries) {
        await sleep(3000);
        continue;
      }

      fail("Failed to publish Instagram media", "IG_PUBLISH_FAILED", err.status || 502, {
        igUserId,
        creationId,
        attempt,
        fbError: err.error,
        errorMessage: err.message,
        response: err.raw,
      });
    }
  }

  fail("Failed to publish Instagram media", "IG_PUBLISH_FAILED", 502, {
    igUserId,
    creationId,
  });
}

export async function publishInstagramImages(opts: {
  igUserId: string;
  accessToken: string;
  caption: string;
  imageUrls: string[];
}) {
  const { igUserId, accessToken, caption, imageUrls } = opts;

  if (!igUserId || !accessToken) {
    fail("Instagram account token is missing", "IG_AUTH_MISSING", 400, {
      hasIgUserId: !!igUserId,
      hasAccessToken: !!accessToken,
    });
  }

  if (!imageUrls?.length) {
    fail("No images provided for Instagram", "IG_IMAGES_MISSING", 400);
  }

  const safeImages = imageUrls.map(normalizeForIg);

  try {
    if (safeImages.length === 1) {
      const creationId = await createMediaContainer({
        igUserId,
        accessToken,
        imageUrl: safeImages[0],
        caption,
      });

      await waitUntilReady({
        creationId,
        accessToken,
      });

      const mediaId = await publishContainer({
        igUserId,
        accessToken,
        creationId,
      });

      return { mediaId, creationId };
    }

    const children: string[] = [];

    for (const imageUrl of safeImages) {
      const childId = await createMediaContainer({
        igUserId,
        accessToken,
        imageUrl,
        isCarouselItem: true,
      });

      await waitUntilReady({
        creationId: childId,
        accessToken,
      });

      children.push(childId);
    }

    const parentId = await createMediaContainer({
      igUserId,
      accessToken,
      caption,
      mediaType: "CAROUSEL",
      children,
    });

    await waitUntilReady({
      creationId: parentId,
      accessToken,
    });

    const mediaId = await publishContainer({
      igUserId,
      accessToken,
      creationId: parentId,
    });

    return {
      mediaId,
      creationId: parentId,
      children,
    };
  } catch (e: any) {
    if (e instanceof AppError) throw e;

    fail("Instagram publish failed", "IG_PUBLISH_UNEXPECTED", 502, {
      igUserId,
      imagesCount: imageUrls.length,
      errorMessage: e?.message,
    });
  }
}

export async function publishInstagramVideo(opts: {
  igUserId: string;
  accessToken: string;
  caption: string;
  videoUrl: string;
  shareToFeed?: boolean;
}) {
  const {
    igUserId,
    accessToken,
    caption,
    videoUrl,
    shareToFeed = true,
  } = opts;

  if (!igUserId || !accessToken) {
    fail("Instagram account token is missing", "IG_AUTH_MISSING", 400);
  }

  if (!videoUrl) {
    fail("No video provided for Instagram", "IG_VIDEO_MISSING", 400);
  }

  try {
    const creationId = await createMediaContainer({
      igUserId,
      accessToken,
      videoUrl,
      caption,
      mediaType: "REELS",
      shareToFeed,
    });

    await waitUntilReady({
      creationId,
      accessToken,
      maxAttempts: 40,
      delayMs: 5000,
    });

    const mediaId = await publishContainer({
      igUserId,
      accessToken,
      creationId,
      retries: 2,
    });

    return { mediaId, creationId };
  } catch (e: any) {
    if (e instanceof AppError) throw e;

    fail("Instagram video publish failed", "IG_VIDEO_PUBLISH_UNEXPECTED", 502, {
      igUserId,
      videoUrlHint: safeUrlHint(videoUrl),
      errorMessage: e?.message,
    });
  }
}