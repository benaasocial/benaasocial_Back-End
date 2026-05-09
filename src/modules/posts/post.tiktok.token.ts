import axios from "axios";
import AppError from "../../utils/AppError";
import { ConnectedAccount } from "../integrations/ConnectedAccount";

export async function getValidTikTokAccessToken(params: {
  userId: string;
  accountId?: string;
}) {
  const { userId, accountId } = params;

  const query: any = {
    userId,
    platform: "tiktok",
    isActive: true,
  };

  if (accountId) query._id = accountId;

  const account: any = await ConnectedAccount.findOne(query).select("+accessToken");

  if (!account) {
    throw new AppError("TikTok account is not connected", 400);
  }

  const refreshToken = account.meta?.refreshToken;

  if (!refreshToken) {
    account.isActive = false;
    await account.save();
    throw new AppError("TikTok needs reconnect. Missing refresh token.", 401);
  }

  const expiresAt = account.tokenExpiresAt
    ? new Date(account.tokenExpiresAt).getTime()
    : 0;

  const tokenStillValid =
    account.accessToken && expiresAt > Date.now() + 5 * 60 * 1000;

  if (tokenStillValid) {
    return account.accessToken;
  }

  const tokenRes = await axios.post(
    "https://open.tiktokapis.com/v2/oauth/token/",
    new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 30_000,
    }
  );

  const newAccessToken = tokenRes.data?.access_token;
  const newRefreshToken = tokenRes.data?.refresh_token || refreshToken;
  const expiresInSec = Number(tokenRes.data?.expires_in);

  if (!newAccessToken) {
    account.isActive = false;
    await account.save();
    throw new AppError("TikTok reconnect required", 401);
  }

  account.accessToken = newAccessToken;
  account.tokenExpiresAt = Number.isFinite(expiresInSec)
    ? new Date(Date.now() + expiresInSec * 1000)
    : undefined;

  account.meta = {
    ...(account.meta || {}),
    refreshToken: newRefreshToken,
  };

  await account.save();

  return newAccessToken;
}