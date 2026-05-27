import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import AppError from "../../utils/AppError";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB

/**
 * Cloudinary transformations used only for TikTok uploads.
 *
 * Why?
 * TikTok is strict with videos. Some videos fail because of:
 * - unsupported codec
 * - high bitrate
 * - variable FPS
 * - non-MP4 format
 *
 * So we ask Cloudinary to deliver a safer version:
 * - MP4
 * - H264 video
 * - AAC audio
 * - 30 FPS
 * - reasonable bitrate
 * - progressive MP4
 */
const TIKTOK_CLOUDINARY_TRANSFORM =
  "f_mp4,vc_h264,ac_aac,fps_30,br_6000k,q_auto:good,fl_progressive";

/**
 * Create consistent AppError objects for this service.
 */
function createError(
  message: string,
  status: number,
  code: string,
  details?: any
) {
  return new AppError(
    message,
    status,
    details ? [details] : [],
    code
  );
}

/**
 * Some errors can be temporary.
 * These statuses usually mean retry might work later.
 */
function shouldRetry(status?: number) {
  return (
    status === 408 ||
    status === 429 ||
    Boolean(status && status >= 500)
  );
}

/**
 * TikTok sometimes returns JSON, sometimes plain text.
 * This helper safely reads either.
 */
async function parseResponse(res: Response) {
  try {
    return await res.json();
  } catch {
    try {
      return await res.text();
    } catch {
      return null;
    }
  }
}

/**
 * If the video comes from Cloudinary,
 * return a TikTok-friendly transformed URL.
 *
 * If it is not a Cloudinary URL, return it as-is.
 */
function getTikTokVideoUrl(videoUrl: string) {
  const isCloudinaryVideo =
    videoUrl.includes("res.cloudinary.com") &&
    videoUrl.includes("/video/upload/");

  if (!isCloudinaryVideo) {
    return videoUrl;
  }

  return videoUrl.replace(
    "/video/upload/",
    `/video/upload/${TIKTOK_CLOUDINARY_TRANSFORM}/`
  );
}

/**
 * Delete temp file safely.
 * Cleanup errors should not break the main flow.
 */
function deleteTempFile(filePath: string | null) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Download video from URL into a temporary local file.
 *
 * TikTok FILE_UPLOAD requires us to know:
 * - file size
 * - file chunks
 *
 * So we download the video first, then upload it to TikTok.
 */
async function downloadVideo(videoUrl: string) {
  const fileName = `tiktok_${Date.now()}_${crypto
    .randomBytes(4)
    .toString("hex")}.mp4`;

  const filePath = path.join(os.tmpdir(), fileName);

  let response;

  try {
    response = await axios.get(videoUrl, {
      responseType: "stream",
      timeout: 90_000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 300,
      headers: {
        Accept: "video/mp4,video/*,*/*",
      },
    });
  } catch (error: any) {
    const status = error?.response?.status;

    throw createError(
      "Video download failed",
      shouldRetry(status) ? 502 : 400,
      "TIKTOK_VIDEO_DOWNLOAD_FAILED",
      {
        step: "download",
        videoUrl,
        httpStatus: status,
        axiosCode: error?.code,
      }
    );
  }

  /**
   * Write remote stream into temp file.
   * While writing, make sure video does not exceed our max limit.
   */
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    let totalSize = 0;
    let finished = false;

    const fail = (error: Error) => {
      if (finished) return;

      finished = true;

      response.data.destroy(error);
      writer.destroy(error);

      reject(error);
    };

    response.data.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;

      if (totalSize > MAX_VIDEO_SIZE) {
        fail(new Error("VIDEO_TOO_LARGE"));
      }
    });

    response.data.on("error", fail);
    writer.on("error", fail);

    writer.on("finish", () => {
      if (finished) return;

      finished = true;
      resolve();
    });

    response.data.pipe(writer);
  }).catch((error) => {
    deleteTempFile(filePath);

    throw createError(
      "Failed while downloading video stream",
      400,
      "TIKTOK_VIDEO_DOWNLOAD_STREAM_FAILED",
      {
        step: "download",
        videoUrl,
        errorMessage: error?.message,
      }
    );
  });

  const stats = fs.statSync(filePath);

  if (!stats.size) {
    deleteTempFile(filePath);

    throw createError(
      "Downloaded video is empty",
      400,
      "TIKTOK_VIDEO_EMPTY",
      {
        step: "download",
        videoUrl,
      }
    );
  }

  return {
    filePath,
    fileSize: stats.size,
  };
}

/**
 * Read part of the file for chunk upload.
 */
async function readChunk(
  fileHandle: fs.promises.FileHandle,
  start: number,
  length: number
) {
  const buffer = Buffer.alloc(length);

  const { bytesRead } = await fileHandle.read(
    buffer,
    0,
    length,
    start
  );

  return buffer.subarray(0, bytesRead);
}

/**
 * Publish video to TikTok using FILE_UPLOAD.
 *
 * Flow:
 * 1. Make Cloudinary URL TikTok-friendly
 * 2. Download video locally
 * 3. Initialize TikTok upload
 * 4. Upload video chunks
 * 5. Return publish_id for status polling
 */
export async function publishTikTokVideo({
  accessToken,
  videoUrl,
  caption,
  privacy_level,
  disable_comment = false,
  disable_duet = false,
  disable_stitch = false,
  forcePrivate = false,
}: {
  accessToken: string;
  videoUrl: string;
  caption: string;

  privacy_level?:
    | "PUBLIC_TO_EVERYONE"
    | "MUTUAL_FOLLOW_FRIENDS"
    | "FOLLOWER_OF_CREATOR"
    | "SELF_ONLY";

  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;

  forcePrivate?: boolean;
}) {
  let filePath: string | null = null;
  let fileHandle: fs.promises.FileHandle | null = null;

  try {
    /**
     * Step 1:
     * Convert Cloudinary video URL into a safer TikTok version.
     *
     * If the video is not from Cloudinary, this returns the original URL.
     */
    const tiktokVideoUrl = getTikTokVideoUrl(videoUrl);

    /**
     * Step 2:
     * Download the video locally so we can calculate size and upload chunks.
     */
    const downloaded = await downloadVideo(tiktokVideoUrl);

    filePath = downloaded.filePath;
    const fileSize = downloaded.fileSize;

    /**
     * Step 3:
     * Decide chunk size.
     *
     * Small videos upload in one chunk.
     * Bigger videos upload in 10MB chunks.
     */
    const chunkSize =
      fileSize <= 5 * 1024 * 1024
        ? fileSize
        : CHUNK_SIZE;

    const totalChunks = Math.ceil(fileSize / chunkSize);

    /**
     * Step 4:
     * Prepare TikTok publish settings.
     */
    const privacy = forcePrivate
      ? "SELF_ONLY"
      : privacy_level ?? "SELF_ONLY";

    /**
     * Step 5:
     * Ask TikTok to create an upload session.
     */
    const initRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: (caption || "").trim().slice(0, 2200),
            privacy_level: privacy,
            disable_comment: Boolean(disable_comment),
            disable_duet: Boolean(disable_duet),
            disable_stitch: Boolean(disable_stitch),
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: fileSize,
            chunk_size: chunkSize,
            total_chunk_count: totalChunks,
          },
        }),
      }
    );

    const initBody: any = await parseResponse(initRes);

    if (!initRes.ok || initBody?.error?.code !== "ok") {
      throw createError(
        "TikTok upload init failed",
        shouldRetry(initRes.status) ? 502 : 400,
        "TIKTOK_INIT_FAILED",
        {
          step: "init",
          httpStatus: initRes.status,
          response: initBody,
          video: {
            originalUrl: videoUrl,
            uploadedUrl: tiktokVideoUrl,
            fileSize,
            chunkSize,
            totalChunks,
          },
        }
      );
    }

    const uploadUrl = initBody?.data?.upload_url;
    const publishId = initBody?.data?.publish_id;

    if (!uploadUrl || !publishId) {
      throw createError(
        "TikTok init response missing fields",
        502,
        "TIKTOK_INIT_INVALID_RESPONSE",
        {
          step: "init",
          response: initBody,
        }
      );
    }

    /**
     * Step 6:
     * Upload file chunks to TikTok.
     */
    fileHandle = await fs.promises.open(filePath, "r");

    for (let index = 0; index < totalChunks; index++) {
      const start = index * chunkSize;
      const endExclusive = Math.min(start + chunkSize, fileSize);
      const end = endExclusive - 1;
      const length = endExclusive - start;

      const chunk = await readChunk(
        fileHandle,
        start,
        length
      );

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        },
        body: chunk,
      });

      /**
       * TikTok returns:
       * - 206 while receiving chunks
       * - 201 when upload is complete
       */
      if (
        uploadRes.status !== 206 &&
        uploadRes.status !== 201
      ) {
        const uploadBody = await parseResponse(uploadRes);

        throw createError(
          "TikTok chunk upload failed",
          shouldRetry(uploadRes.status) ? 502 : 400,
          "TIKTOK_UPLOAD_FAILED",
          {
            step: "upload",
            httpStatus: uploadRes.status,
            chunk: {
              index,
              total: totalChunks,
              start,
              end,
              size: chunk.length,
            },
            response: uploadBody,
          }
        );
      }
    }

    /**
     * TikTok publishing is async.
     * This publish_id is used later to check final status.
     */
    return {
      publish_id: publishId,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }

    throw createError(
      "TikTok upload failed",
      502,
      "TIKTOK_UNEXPECTED",
      {
        errorMessage: error?.message,
      }
    );
  } finally {
    /**
     * Always cleanup temp resources.
     */
    try {
      if (fileHandle) {
        await fileHandle.close();
      }
    } catch {
      // ignore cleanup errors
    }

    deleteTempFile(filePath);
  }
}