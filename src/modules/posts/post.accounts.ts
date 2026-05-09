import { Platform } from "../../types/type";
import { ConnectedAccount } from "../integrations/ConnectedAccount";

/**
 * Loads active connected accounts for the given user and platforms.
 * Returns a Map for fast lookup by platform.
 */
export async function loadActiveAccounts(userId: string, platforms: Platform[]) {
  const accounts = await ConnectedAccount.find({
    userId,
    platform: { $in: platforms },
    isActive: true,
  })
    .select("platform accountExternalId accountName tokenExpiresAt meta +accessToken")
    .lean();

  return new Map(accounts.map((a: any) => [a.platform as Platform, a]));
}


/**
 * Marks platforms as failed when the user has no active connected account for them.
 */
export function markMissingAccounts(post: any, missing: Platform[]) {
  // Ensure publishResults exists before writing into it
  post.publishResults = post.publishResults || {};

  for (const p of missing) {
    post.publishResults[p] = {
      status: "failed",
      externalId: null,
      error: "Platform not connected/active",
      publishedAt: null,
    };
  }
}