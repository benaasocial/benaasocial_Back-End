import { Schema, model, models } from "mongoose";

/**
 * OAuth state model.
 *
 * Used to temporarily store OAuth flow state data:
 * - Prevent CSRF
 * - Link state to a specific user
 * - Expire automatically after a short time
 */
const OAuthStateSchema = new Schema(
  {
    // Unique state value sent to OAuth provider
    state: { type: String, required: true, unique: true },

    // The user who initiated the OAuth flow
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // When this state should expire
    expiresAt: { type: Date, required: true },

    // Prevents reusing the same state twice
    used: { type: Boolean, default: false },

    // OAuth provider
    provider: {
      type: String,
      enum: ["meta", "tiktok", "youtube"],
      required: true,
      index: true,
    },

    // Used for PKCE flow (TikTok / X)
    codeVerifier: { type: String },

    // Platform requested during OAuth (Meta only for now)
    requestedPlatform: {
      type: String,
      enum: ["facebook", "instagram"],
      default: undefined,
      index: true,
    },

    // Optional extra metadata related to the OAuth flow
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Automatically deletes documents when expiresAt is reached.
OAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OAuthState =
  models.OAuthState || model("OAuthState", OAuthStateSchema);

export default OAuthState;