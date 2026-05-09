import axios from "axios";
import { google } from "googleapis";

type PublishYouTubeVideoParams = {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date | string | null;
  videoUrl: string;
  title: string;
  description?: string;
  privacyStatus?: "private" | "public" | "unlisted";
};

export const publishYouTubeVideo = async ({
  accessToken,
  refreshToken,
  tokenExpiresAt,
  videoUrl,
  title,
  description = "",
  privacyStatus = "public",
}: PublishYouTubeVideoParams) => {
  /**
   * Create an OAuth2 client using Google app credentials.
   * This client is used to authenticate YouTube API requests.
   */
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  /**
   * Set the current token credentials.
   * We pass the access token for immediate use,
   * and the refresh token so Google can issue a new access token if needed.
   */
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : undefined,
  });

  /**
   * Convert the token expiry time into milliseconds.
   * If the token is missing or about to expire within the next minute,
   * we refresh it before starting the upload.
   */
  const expiresAtMs = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : 0;

  const shouldRefresh =
    !!refreshToken &&
    (!expiresAtMs || expiresAtMs <= Date.now() + 60_000);

  /**
   * Refresh the access token if needed.
   * This helps avoid upload failures caused by expired tokens.
   */
  if (shouldRefresh) {
    const { credentials } = await oauth2Client.refreshAccessToken();

    oauth2Client.setCredentials({
      access_token: credentials.access_token ?? accessToken,
      refresh_token: credentials.refresh_token ?? refreshToken,
      expiry_date: credentials.expiry_date ?? expiresAtMs,
    });
  }

  /**
   * Create a YouTube API client using the authenticated OAuth2 client.
   */
  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client,
  });

  /**
   * Download the source video as a stream.
   * We stream the file directly instead of loading it fully into memory.
   */
  const videoResponse = await axios.get(videoUrl, {
    responseType: "stream",
    maxRedirects: 5,
  });

  /**
   * Validate the returned content type.
   * YouTube upload should only continue if the source is actually a video.
   */
  const contentType = videoResponse.headers["content-type"];

  if (!contentType || !contentType.startsWith("video/")) {
    throw new Error(
      `Invalid source content-type for YouTube upload: ${contentType || "unknown"}`
    );
  }

  /**
   * Upload the video to YouTube.
   *
   * requestBody.snippet:
   * - title: video title shown on YouTube
   * - description: video description shown below the video
   *
   * requestBody.status:
   * - privacyStatus: controls whether the video is public, private, or unlisted
   *
   * media:
   * - mimeType: detected content type from the downloaded video
   * - body: streamed video file
   */
  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
      },
      status: {
        privacyStatus,
      },
    },
    media: {
      mimeType: contentType,
      body: videoResponse.data,
    },
  });

  /**
   * Return the uploaded YouTube video id
   * so it can be stored in the post publish result.
   */
  return {
    videoId: response.data.id,
  };
};