import AppError from "../../utils/AppError";

export async function fetchTikTokPublishStatus({
  accessToken,
  publishId,
}: {
  accessToken: string;
  publishId: string;
}) {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        publish_id: publishId,
      }),
    }
  );

  let body: any = null;

  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok || body?.error?.code !== "ok") {
    throw new AppError(
      body?.error?.message ||
        body?.error?.code ||
        "Failed to fetch TikTok publish status",
      400,
      [{ status: res.status, response: body }],
      "TIKTOK_STATUS_FETCH_FAILED"
    );
  }

  return body.data;
}