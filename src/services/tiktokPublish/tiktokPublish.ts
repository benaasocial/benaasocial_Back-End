import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import AppError from "../../utils/AppError";

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB max allowed size

/**
 * Helper to create a standardized AppError
 */
function createError(message: string, status: number, code: string, details?: any) {
  return new AppError(message, status, details ? [details] : [], code);
}

/**
 * Determine if a request should be retried based on HTTP status
 */
function shouldRetry(status?: number) {
  return status === 408 || status === 429 || (status && status >= 500);
}

/**
 * Safely parse a fetch response (JSON or text fallback)
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
 * Download video from remote URL and store it temporarily
 */
async function downloadVideo(videoUrl: string) {
  const fileName = `tiktok_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.mp4`;
  const filePath = path.join(os.tmpdir(), fileName);

  let response;

  try {
    response = await axios.get(videoUrl, {
      responseType: "stream",
      timeout: 60000,
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 300,
    });
  } catch (error: any) {
    const status = error?.response?.status;

    throw createError(
      "Video download failed",
      shouldRetry(status) ? 502 : 400,
      "TIKTOK_VIDEO_DOWNLOAD_FAILED",
      {
        step: "download",
        httpStatus: status,
        axiosCode: error?.code,
        response: error?.response?.data,
      }
    );
  }

  /**
   * Stream video into a temp file while checking max size
   */
  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    let total = 0;

    response.data.on("data", (chunk: Buffer) => {
      total += chunk.length;

      if (total > MAX_VIDEO_SIZE) {
        response.data.destroy(new Error("VIDEO_TOO_LARGE"));
        writer.destroy(new Error("VIDEO_TOO_LARGE"));
      }
    });

    response.data.pipe(writer);

    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  }).catch((e) => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}

    throw createError(
      "Failed while downloading video stream",
      400,
      "TIKTOK_VIDEO_DOWNLOAD_STREAM_FAILED",
      {
        step: "download",
        errorMessage: e?.message,
      }
    );
  });

  const stats = fs.statSync(filePath);

  /**
   * Validate downloaded file is not empty
   */
  if (!stats.size) {
    fs.unlinkSync(filePath);

    throw createError(
      "Downloaded video is empty",
      400,
      "TIKTOK_VIDEO_EMPTY",
      { step: "download" }
    );
  }

  return { filePath, fileSize: stats.size };
}

/**
 * Read a chunk from file using file descriptor
 */
async function readChunk(fd: fs.promises.FileHandle, start: number, length: number) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await fd.read(buffer, 0, length, start);
  return buffer.subarray(0, bytesRead);
}

/**
 * Main TikTok publishing function
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
  privacy_level?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY";
  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;
  forcePrivate?: boolean;
}) {
  let filePath: string | null = null;
  let fileHandle: fs.promises.FileHandle | null = null;

  try {
    /**
     * Step 1: Download video locally
     */
    const { filePath: tempPath, fileSize } = await downloadVideo(videoUrl);
    filePath = tempPath;

    /**
     * Step 2: Calculate chunking strategy
     */
    const chunkSize = fileSize <= 5 * 1024 * 1024 ? fileSize : CHUNK_SIZE;
    const totalChunks = Math.ceil(fileSize / chunkSize);

    /**
     * Privacy handling:
     * - If forcePrivate = true → override everything to SELF_ONLY
     * - Otherwise → use provided privacy_level
     * - Default fallback → PUBLIC
     */
    const privacy = forcePrivate
      ? "SELF_ONLY"
      : (privacy_level ?? "SELF_ONLY");

    /**
     * Step 3: Initialize TikTok upload session
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
            disable_comment,
            disable_duet,
            disable_stitch,
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
     * Step 4: Upload video in chunks
     */
    fileHandle = await fs.promises.open(filePath, "r");

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const endExclusive = Math.min(start + chunkSize, fileSize);
      const end = endExclusive - 1;
      const length = endExclusive - start;

      const chunk = await readChunk(fileHandle, start, length);

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        },
        body: chunk,
      });

      if (uploadRes.status !== 206 && uploadRes.status !== 201) {
        const body = await parseResponse(uploadRes);

        throw createError(
          "TikTok chunk upload failed",
          shouldRetry(uploadRes.status) ? 502 : 400,
          "TIKTOK_UPLOAD_FAILED",
          {
            step: "upload",
            httpStatus: uploadRes.status,
            chunk: {
              index: i,
              total: totalChunks,
              start,
              end,
              size: chunk.length,
            },
            response: body,
          }
        );
      }
    }

    /**
     * Return publish id (used later to track status)
     */
    return { publish_id: publishId };

  } catch (error: any) {
    if (error instanceof AppError) throw error;

    throw createError(
      "TikTok upload failed",
      502,
      "TIKTOK_UNEXPECTED",
      { errorMessage: error?.message }
    );

  } finally {
    /**
     * Cleanup resources:
     * - Close file handle
     * - Delete temp file
     */
    try {
      if (fileHandle) await fileHandle.close();
    } catch {}

    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
}