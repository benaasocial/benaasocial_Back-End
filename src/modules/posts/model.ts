import { Schema, model } from "mongoose";

/**
 * Image media item stored inside a post.
 * _id is disabled because it's an embedded object (not a standalone collection).
 */
const ImageSchema = new Schema(
  {
    // Discriminator for safety (helps when mixed arrays exist)
    kind: { type: String, enum: ["image"], required: true },

    // Public URL (CDN / cloud storage)
    url: { type: String, required: true },

    // Provider file id (e.g., Cloudinary public_id)
    publicId: { type: String, required: true },

    // Useful for rendering / validations
    width: { type: Number, required: true },
    height: { type: Number, required: true },

    // Optional, e.g. "jpg", "png"
    format: String,
  },
  { _id: false }
);

/**
 * Video media item stored inside a post.
 */
const VideoSchema = new Schema(
  {
    kind: { type: String, enum: ["video"], required: true },
    url: { type: String, required: true },
    publicId: { type: String, required: true },

    // Video length in seconds
    duration: { type: Number, required: true },

    // e.g. "mp4"
    format: { type: String, required: true },
  },
  { _id: false }
);

/**
 * Post media container.
 * A post can be either:
 * - kind = "images"  -> images[] must exist
 * - kind = "video"   -> video must exist
 *
 * Note: This is a "shape" type for TS only.
 */
type MediaDoc = {
  kind: "images" | "video";
  images?: Array<any>;
  video?: any;
};

const MediaSchema = new Schema<MediaDoc>(
  {
    // "images" means multiple image items (not "image")
    kind: { type: String, enum: ["images", "video"], required: true },

    // Only used when kind === "images"
    images: { type: [ImageSchema] },

    // Only used when kind === "video"
    video: { type: VideoSchema },
  },
  { _id: false }
);

/**
 * Publishing result per platform.
 * Used to track what happened when posting to each platform.
 */
const PlatformResultSchema = new Schema(
  {
    // idle = not attempted yet, published = success, failed = error
    status: {
      type: String,
      enum: ["idle", "published", "failed"],
      default: "idle",
    },

    // ID returned from the platform after publishing (post id, video id, etc.)
    externalId: { type: String, default: null },

    // Error message if publishing failed
    error: { type: String, default: null },

    // When it was published successfully
    publishedAt: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * Publish results for all supported platforms.
 * Always present so frontend can render a consistent structure.
 */
const PublishResultsSchema = new Schema(
  {
    facebook: { type: PlatformResultSchema, required: true },
    instagram: { type: PlatformResultSchema, required: true },
    tiktok: { type: PlatformResultSchema, required: true },
    youtube: { type: PlatformResultSchema, required: true },
  },
  { _id: false }
);

/**
 * Main Post schema.
 * Represents a user post (draft or publish request) and its state.
 */
const PostSchema = new Schema(
  {
    // Owner of the post
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /**
     * action:
     * - draft   -> user saved draft
     * - publish -> user requested publishing
     */
    action: {
      type: String,
      enum: ["draft", "publish"],
      required: true,
    },

    /**
     * status:
     * - draft       -> saved but not queued
     * - queued      -> waiting for worker
     * - publishing  -> worker is publishing now
     * - published   -> all targets succeeded
     * - partial     -> some succeeded, some failed
     * - failed      -> all failed (or unrecoverable)
     */
    status: {
      type: String,
      enum: ["draft", "queued", "publishing", "published", "partial", "failed"],
      required: true,
    },

    // Post text/caption
    caption: {
      type: String,
      default: "",
      maxLength: 5000,
    },

    // Hashtags extracted or entered by user
    hashtags: {
      type: [String],
      default: [],
    },

    /**
     * targets:
     * Which platforms this post should be sent to.
     * Example: { facebook: true, instagram: true, tiktok: false }
     */
    targets: {
      facebook: { type: Boolean, default: false },
      instagram: { type: Boolean, default: false },
      tiktok: { type: Boolean, default: false },
      youtube: { type: Boolean, default: false },
    },

    /**
     * publishResults:
     * Always exists so you can update per-platform status independently.
     */
    publishResults: {
      type: PublishResultsSchema,
      required: true,
      default: () => ({
        facebook: { status: "idle" },
        instagram: { status: "idle" },
        tiktok: { status: "idle" },
        youtube: { status: "idle" },
      }),
    },

    /**
     * media:
     * Required. Contains either images[] or video (based on media.kind).
     */
    media: {
      type: MediaSchema,
      required: true,
    },
  },
  { timestamps: true }
);

// Common query pattern: list user posts ordered by newest
PostSchema.index({ user: 1, createdAt: -1 });

const Post = model("Post", PostSchema);
export default Post;