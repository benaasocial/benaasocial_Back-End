import AppError from "../../utils/AppError";

export async function getTikTokCreatorInfo(accessToken: string) {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  const body = await res.json();

  if (!res.ok || body?.error?.code !== "ok") {
    throw new AppError(
      "Failed to fetch TikTok creator info",
      400,
      [
        {
          status: res.status,
          response: body,
        },
      ],
      "TIKTOK_CREATOR_INFO_FAILED"
    );
  }

  return body.data;
}