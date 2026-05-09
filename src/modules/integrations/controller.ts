import crypto from "crypto";
import { ConnectedAccount } from "./ConnectedAccount";
import axios from "axios";
import OAuthState from "./OAuth";
import { AuthenticatedRequest } from "../../types/express";
import dotenv from "dotenv";
import { NextFunction, Request, Response } from "express";
import AppError from "../../utils/AppError";
import { sendSuccess } from "../../utils/response";

// configure env
dotenv.config();







/* ===============================
   META (Facebook + Instagram)
================================ */



/**
 * Starts the Meta OAuth flow.
 * - Generates a secure state value.
 * - Stores it temporarily in DB.
 * - Returns the Facebook OAuth URL to the frontend.
 */
export const metaStartUrl = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  // Make sure user is authenticated
  const userId = req.user?._id;
  if (!userId) return next(new AppError("Unauthorized", 401));

  // Optional platform selection (facebook or instagram)
  const requestedPlatform =
    req.query.platform === "facebook" || req.query.platform === "instagram"
      ? (req.query.platform as "facebook" | "instagram")
      : undefined;

  // Generate random state to prevent CSRF attacks
  const state = crypto.randomBytes(16).toString("hex");

  // Save state in DB with expiration (10 minutes)
  await OAuthState.create({
    state,
    userId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    used: false,
    provider: "meta",
    requestedPlatform,
  });

  // Ensure required environment variables exist
  if (!process.env.META_APP_ID || !process.env.META_REDIRECT_URI) {
    return next(new AppError("Meta config missing", 500));
  }

  // Build OAuth URL parameters
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    scope:
      "public_profile,email,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish",
    state,
    response_type: "code",
  });

  const url = `https://www.facebook.com/v25.0/dialog/oauth?${params.toString()}`;

  // Send the OAuth URL to frontend
  return sendSuccess(req, res, { url }, 200);
};




/**
 * Meta OAuth callback.
 * - Validates code/state
 * - Exchanges code for a long-lived user token
 * - Stores token in the OAuthState session
 * - Redirects to frontend to continue the flow
 */
export const metaCallback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Read code/state from query
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;

    if (!code || !state) return next(new AppError("Missing code/state", 400));

    // Validate required env vars
    const { META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, FRONTEND_URL } = process.env;
    if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI || !FRONTEND_URL) {
      return next(new AppError("Meta config missing", 500));
    }

    // Load state session from DB
    const session = await OAuthState.findOne({ state, provider: "meta" });
    if (!session) return next(new AppError("Invalid state", 400));
    if (session.used) return next(new AppError("State already used", 400));
    if (session.expiresAt < new Date()) return next(new AppError("State expired", 400));

    // 1) Exchange code -> short-lived user token
    const tokenResp = await axios.get("https://graph.facebook.com/v25.0/oauth/access_token", {
      params: { client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: META_REDIRECT_URI, code },
      timeout: 30_000,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const shortUserAccessToken: string | undefined = tokenResp.data?.access_token;
    if (!shortUserAccessToken) return next(new AppError("Failed to get access token", 400));

    // 2) Exchange short-lived -> long-lived token (recommended by Meta)
    const longResp = await axios.get("https://graph.facebook.com/v25.0/oauth/access_token", {
      params: {
        grant_type: "fb_exchange_token",
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: shortUserAccessToken,
      },
      timeout: 30_000,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const longLivedUserAccessToken: string | undefined = longResp.data?.access_token;
    if (!longLivedUserAccessToken) return next(new AppError("Failed to get long-lived access token", 400));

    // Mark session as used and store token for next steps (pages selection)
    session.used = true;
    session.meta = { ...(session.meta || {}), userAccessToken: longLivedUserAccessToken };
    await session.save();

    // Redirect frontend to continue the connection flow
    return res.redirect(`${FRONTEND_URL}/dashboard/connect?state=${state}&platform=meta`);
  } catch (e: any) {
    // Try to show a readable Meta error (if present)
    const fbMsg = e?.response?.data?.error?.message;
    return next(new AppError(fbMsg || e?.message || "Meta callback failed", 400));
  }
};

/**
 * Get user's Meta pages using the stored user access token.
 * Requires:
 * - authenticated user
 * - valid (not expired) OAuth state session
 */
export const metaPages = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  // Ensure user is authenticated
  const userId = req.user?._id;
  if (!userId) return next(new AppError("Unauthorized", 401));

  // Read OAuth state from query
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  if (!state) {
    return next(new AppError("Invalid input", 400, [{ field: "state", message: "Required" }]));
  }

  // Load the saved OAuth session (must match the same user)
  const session = await OAuthState.findOne({ state, provider: "meta", userId });
  if (!session) return next(new AppError("Invalid state", 400));
  if (session.expiresAt < new Date()) return next(new AppError("State expired", 400));

  // Token was stored during the callback step
  const userAccessToken = session.meta?.userAccessToken;
  if (!userAccessToken) return next(new AppError("Session token missing", 400));

  // Fetch pages the user can manage
  const pagesResp = await axios.get("https://graph.facebook.com/v25.0/me/accounts", {
    params: { access_token: userAccessToken, fields: "id,name" },
    timeout: 30_000,
  });


  const pages = pagesResp.data?.data ?? [];
  if (!Array.isArray(pages)) return next(new AppError("Invalid pages response", 400));

  // Return pages list to frontend
  return sendSuccess(req, res, { pages }, 200);
};


/**
 * Select a Meta Page to connect.
 * - Reads the user's pages (with page tokens)
 * - Stores the selected Facebook page account
 * - Tries to detect linked Instagram business account and store it too
 */
export const metaSelectPage = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?._id;
    if (!userId) return next(new AppError("Unauthorized", 401));

    // Read required fields from body
    const state = typeof req.body?.state === "string" ? req.body.state : undefined;
    const pageId = typeof req.body?.pageId === "string" ? req.body.pageId : undefined;

    if (!state || !pageId) {
      return next(
        new AppError(
          "Invalid input",
          400,
          [
            !state ? { field: "state", message: "Required" } : null,
            !pageId ? { field: "pageId", message: "Required" } : null,
          ].filter(Boolean)
        )
      );
    }

    // Validate session
    const session = await OAuthState.findOne({ state, provider: "meta", userId });
    if (!session) return next(new AppError("Invalid state", 400));
    if (session.expiresAt < new Date()) return next(new AppError("State expired", 400));

    const requested = session.requestedPlatform; // facebook | instagram | null/undefined
    const userAccessToken = session.meta?.userAccessToken;
    if (!userAccessToken) return next(new AppError("Session token missing", 400));

    // 1) Fetch pages including page access tokens
    const pagesResp = await axios.get("https://graph.facebook.com/v25.0/me/accounts", {
      params: { access_token: userAccessToken, fields: "id,name,access_token" },
      timeout: 30_000,
      validateStatus: (s) => s >= 200 && s < 300,
    });


    const pages: any[] = pagesResp.data?.data ?? [];
    if (!Array.isArray(pages) || pages.length === 0) {
      return next(new AppError("No Facebook Pages found for this user", 400));
    }

    // Find selected page
    const page = pages.find((p: any) => p?.id === pageId);
    if (!page?.id || !page?.access_token) {
      return next(new AppError("Invalid page selected", 400, [{ field: "pageId", message: "Not found in user pages" }]));
    }

    const pageAccessToken: string = page.access_token;

    // 2) Save Facebook connected account
    await ConnectedAccount.findOneAndUpdate(
      { userId, platform: "facebook" },
      {
        userId,
        platform: "facebook",
        accountExternalId: page.id,
        accountName: page.name,
        accessToken: pageAccessToken,
        isActive: requested === "facebook" || requested == null,
      },
      { upsert: true, new: true }
    );

    // 3) Try to fetch Instagram business account linked to this page
    let ig: any = null;
    try {
      const pageInfoResp = await axios.get(`https://graph.facebook.com/v24.0/${page.id}`, {
        params: { access_token: pageAccessToken, fields: "instagram_business_account{id,username}" },
        timeout: 30_000,
        validateStatus: (s) => s >= 200 && s < 300,
      });

      ig = pageInfoResp.data?.instagram_business_account ?? null;
    } catch (e: any) {
      // If user requested IG specifically, fail clearly. Otherwise ignore and keep Facebook only.
      if (requested === "instagram") {
        const fbMsg = e?.response?.data?.error?.message;
        return next(new AppError(fbMsg || "Failed to read Instagram account for this Page", 400));
      }
      ig = null;
    }

    // If IG was explicitly requested but not linked
    if (requested === "instagram" && !ig?.id) {
      return next(
        new AppError("Instagram not linked to this page", 400, [
          { field: "pageId", message: "This page has no Instagram business account linked" },
        ])
      );
    }

    // Save Instagram connection if found
    if (ig?.id) {
      await ConnectedAccount.findOneAndUpdate(
        { userId, platform: "instagram" },
        {
          userId,
          platform: "instagram",
          accountExternalId: ig.id,
          accountName: ig.username ?? "Instagram",
          accessToken: pageAccessToken,
          isActive: requested === "instagram" || requested == null,
        },
        { upsert: true, new: true }
      );
    }

    // Return a simple summary to the frontend
    return sendSuccess(
      req,
      res,
      {
        connected: true,
        facebook: { pageId: page.id },
        instagram: ig?.id ? { igUserId: ig.id } : null,
      },
      200
    );
  } catch (e: any) {
    const fbMsg = e?.response?.data?.error?.message;
    return next(new AppError(fbMsg || e?.message || "Meta page selection failed", 400));
  }
};





/* ===============================
   TIKTOK
================================ */



/**
 * Convert a buffer to base64url format.
 * Used for PKCE (TikTok requires S256 challenge).
 */
function base64url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Generate SHA256 hash from the code verifier.
 * Part of PKCE flow.
 */
function sha256(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest();
}

/**
 * Starts TikTok OAuth flow.
 * - Generates state and PKCE values
 * - Stores them temporarily in DB
 * - Returns TikTok authorization URL
 */
export const tiktokStartUrl = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  // Make sure user is authenticated
  const userId = req.user?._id;
  if (!userId) return next(new AppError("Unauthorized", 401));

  // Ensure required env variables exist
  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_REDIRECT_URI) {
    return next(new AppError("Missing TikTok client key or redirect URI", 400));
  }

  // Generate secure state (prevents CSRF)
  const state = crypto.randomBytes(16).toString("hex");

  // Generate PKCE verifier and challenge
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(sha256(codeVerifier));

  // Store state + verifier temporarily (expires in 10 minutes)
  await OAuthState.create({
    state,
    userId,
    provider: "tiktok",
    codeVerifier,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    used: false,
  });

  // Build TikTok authorization URL
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    response_type: "code",
    scope: "user.info.basic,video.upload,video.publish",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const url = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;

  // Send URL back to frontend
  return sendSuccess(req, res, { url }, 200);
};


/**
 * TikTok OAuth callback.
 * - Validates code/state
 * - Exchanges code for access token (PKCE)
 * - Reads basic user info
 * - Saves connected account (and refresh token in meta)
 * - Marks state as used
 */
export const tiktokCallback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;

    if (!code || !state) return next(new AppError("Missing code/state", 400));

    if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET || !process.env.TIKTOK_REDIRECT_URI) {
      return next(new AppError("Missing TikTok client key/secret or redirect URI", 400));
    }

    const session = await OAuthState.findOne({ state, provider: "tiktok" });
    if (!session) return next(new AppError("Invalid state", 400));
    if (session.used) return next(new AppError("State already used", 400));
    if (session.expiresAt < new Date()) return next(new AppError("State expired", 400));

    const userId = session.userId;
    const codeVerifier = session.codeVerifier;
    if (!codeVerifier) return next(new AppError("Missing code verifier", 400));

    // Exchange code -> access token
    const tokenRes = await axios.post(
      "https://open.tiktokapis.com/v2/oauth/token/",
      new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.TIKTOK_REDIRECT_URI,
        code_verifier: codeVerifier,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 30_000 }
    );

    const accessToken = tokenRes.data?.access_token;
    const refreshToken = tokenRes.data?.refresh_token;
    const expiresIn = tokenRes.data?.expires_in;
    const openId = tokenRes.data?.open_id;

    if (!accessToken || !openId) return next(new AppError("TikTok token exchange failed", 400));

    // Read basic user info for display name
    const infoRes = await axios.get("https://open.tiktokapis.com/v2/user/info/", {
      params: { fields: "display_name,avatar_url" },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 30_000,
    });

    const accountName =
      infoRes.data?.data?.user?.display_name ||
      infoRes.data?.data?.user?.username ||
      "TikTok";

    const expiresInSec = Number(expiresIn);

    // Save the connected account
    await ConnectedAccount.findOneAndUpdate(
      { userId, platform: "tiktok" },
      {
        userId,
        platform: "tiktok",
        accountExternalId: openId,
        accountName,
        accessToken,
        tokenExpiresAt: Number.isFinite(expiresInSec)
          ? new Date(Date.now() + expiresInSec * 1000)
          : undefined,
        isActive: true,
        meta: { refreshToken },
      },
      { upsert: true, new: true }
    );

    // Mark state as used so it can't be reused
    session.used = true;
    await session.save();

    return res.redirect(`${process.env.TIKTOK_FRONTEND_REDIRECT}?tiktok=1`);
  } catch (e: any) {
    const msg = e?.response?.data?.error?.message || e?.message || "TikTok callback failed";
    return next(new AppError(msg, 400));
  }
};








/**
 * Enable/disable a connected platform.
 * If disabled, we clear tokens and external account info.
 */
export const setPlatformActive = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user?._id;
  if (!userId) return next(new AppError("Unauthorized", 401));

  const { platform } = req.params;
  const { active } = req.body as { active: boolean };

  const nextActive = Boolean(active);
  const update: any = { isActive: nextActive };

  // When disabling, clear sensitive data
  if (!nextActive) {
    update.accessToken = null;
    update.tokenExpiresAt = null;
    update.accountExternalId = null;
    update.accountName = null;
    update.meta = {};
  }

  const acc = await ConnectedAccount.findOneAndUpdate({ userId, platform }, update, { new: true })
    .select("platform isActive accountName accountExternalId +accessToken");

  if (!acc) return next(new AppError("Account not connected yet", 400));

  const connected = Boolean(acc.accountExternalId && acc.accessToken);

  return sendSuccess(
    req,
    res,
    {
      platform: acc.platform,
      connected,
      active: acc.isActive,
      accountName: acc.accountName,
      accountExternalId: acc.accountExternalId,
    },
    200,
    connected ? "Connected account" : "Disconnected account"
  );
};



const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "telegram"] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * Returns connection status for all supported platforms.
 */
export const getConnectionsStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const userId = req.user?._id;
  if (!userId) return next(new AppError("Unauthorized", 401));

  const accounts = await ConnectedAccount.find({
    userId,
    platform: { $in: PLATFORMS },
  }).select("platform accountName accountExternalId isActive");

  const result: Record<Platform, any> = {
    facebook: { connected: false, active: false },
    instagram: { connected: false, active: false },
    tiktok: { connected: false, active: false },
    youtube: { connected: false, active: false },
    telegram: { connected: false, active: false },
  };

  for (const acc of accounts) {
    const p = acc.platform as Platform;
    const connected = Boolean(acc.accountExternalId) && Boolean(acc.accountName);

    result[p] = {
      connected,
      active: connected ? Boolean(acc.isActive) : false,
      accountName: connected ? acc.accountName : undefined,
      accountExternalId: connected ? acc.accountExternalId : undefined,
    };
  }

  return sendSuccess(req, res, { connections: result }, 200);
};









/* ===============================
   YOUTUBE
================================ */

export const youtubeStartUrl = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const userId = req.user?._id;
  if (!userId) return next(new AppError("Unauthorized", 401));

  const state = crypto.randomBytes(16).toString("hex");

  await OAuthState.create({
    state,
    userId,
    provider: "youtube",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    used: false,
  });

  const { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    return next(new AppError("Google config missing", 500));
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ].join(" "),
    state,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return sendSuccess(req, res, { url }, 200);
};





export const youtubeCallback = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;

  if (!code || !state) return next(new AppError("Missing code/state", 400));

  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    GOOGLE_FRONTEND_REDIRECT,
  } = process.env;

  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_REDIRECT_URI ||
    !GOOGLE_FRONTEND_REDIRECT
  ) {
    return next(new AppError("Google config missing", 500));
  }

  const session = await OAuthState.findOne({ state, provider: "youtube" });
  if (!session) return next(new AppError("Invalid state", 400));
  if (session.used) return next(new AppError("State already used", 400));
  if (session.expiresAt < new Date()) return next(new AppError("State expired", 400));

  const tokenResp = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 30_000,
    }
  );

  const accessToken = tokenResp.data?.access_token;
  const refreshToken = tokenResp.data?.refresh_token;
  const expiresIn = tokenResp.data?.expires_in;

  if (!accessToken) {
    return next(new AppError("Failed to get Google access token", 400));
  }

  session.used = true;
  session.meta = {
    ...(session.meta || {}),
    accessToken,
    refreshToken,
    expiresIn,
  };

  await session.save();

  return res.redirect(`${GOOGLE_FRONTEND_REDIRECT}?state=${state}&platform=youtube`);

};


export const youtubeChannel = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const userId = req.user?._id;
  if (!userId) return next(new AppError("Unauthorized", 401));

  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  if (!state) {
    return next(
      new AppError("Invalid input", 400, [
        { field: "state", message: "Required" },
      ])
    );
  }

  const session = await OAuthState.findOne({
    state,
    provider: "youtube",
    userId,
  });


  if (!session) return next(new AppError("Invalid state", 400));
  if (session.expiresAt < new Date()) return next(new AppError("State expired", 400));

  const accessToken = session.meta?.accessToken;
  const refreshToken = session.meta?.refreshToken;
  const expiresIn = session.meta?.expiresIn;

  if (!accessToken) {
    return next(new AppError("Session token missing", 400));
  }

  const channelResp = await axios.get(
    "https://www.googleapis.com/youtube/v3/channels",
    {
      params: {
        part: "snippet",
        mine: true,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 30_000,
    }
  );

  const channel = channelResp.data?.items?.[0];

  if (!channel?.id) {
    return next(
      new AppError(
        "No YouTube channel found for this Google account. Please create a YouTube channel first.",
        400
      )
    );
  }

  await ConnectedAccount.findOneAndUpdate(
    { userId, platform: "youtube" },
    {
      userId,
      platform: "youtube",
      accountExternalId: channel.id,
      accountName: channel.snippet?.title || "YouTube",
      accessToken,
      tokenExpiresAt: Number.isFinite(Number(expiresIn))
        ? new Date(Date.now() + Number(expiresIn) * 1000)
        : undefined,
      isActive: true,
      meta: { refreshToken },
    },
    { upsert: true, new: true }
  );

  return sendSuccess(
    req,
    res,
    {
      connected: true,
      youtube: {
        channelId: channel.id,
        title: channel.snippet?.title || "YouTube",
      },
    },
    200
  );
};
