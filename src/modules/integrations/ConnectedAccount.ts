import { Schema, model, models } from "mongoose";

/**
 * Stores external platform accounts connected by a user.
 * Example: Facebook page, Instagram account, TikTok account.
 */
const ConnectedAccountSchema = new Schema(
  {
    // Owner of this connected account
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Platform name
    platform: {
      type: String,
      enum: ["facebook", "instagram", "tiktok", "youtube"],
      required: true,
      index: true,
    },

    // External platform account ID
    accountExternalId: {
      type: String,
      trim: true,
      default: null,
    },

    // Display name of the external account
    accountName: {
      type: String,
      trim: true,
      default: null,
    },

    // Access token (hidden by default in queries)
    accessToken: {
      type: String,
      default: null,
      select: false,
    },

    // When the access token expires
    tokenExpiresAt: {
      type: Date,
    },

    // Whether this connection is currently active
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Optional extra data from the provider
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

/**
 * Prevent duplicate connections:
 * Same user cannot connect the same platform account twice.
 */
ConnectedAccountSchema.index(
  { userId: 1, platform: 1, accountExternalId: 1 },
  { unique: true }
);

export const ConnectedAccount =
  models.ConnectedAccount ||
  model("ConnectedAccount", ConnectedAccountSchema);