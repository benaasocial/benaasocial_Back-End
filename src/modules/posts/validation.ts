import { z } from "zod";

/**
 * Targets: which platforms to publish to.
 * All fields are optional, frontend can send only the ones it wants.
 */
const targetsSchema = z
  .object({
    facebook: z.boolean().optional(),
    instagram: z.boolean().optional(),
    tiktok: z.boolean().optional(),
    youtube: z.boolean().optional(),
  })
  .default({});

/**
 * Single image item.
 */
const imageItemSchema = z.object({
  kind: z.literal("image").optional(),
  url: z.string().url("Invalid image url"),
  publicId: z.string().min(1, "publicId is required"),
  width: z.number().int().positive("width must be positive"),
  height: z.number().int().positive("height must be positive"),
  format: z.string().optional(),
});

/**
 * Video object.
 */
const videoSchema = z.object({
  kind: z.literal("video").optional(),
  url: z.string().url("Invalid video url"),
  publicId: z.string().min(1, "publicId is required"),
  duration: z.number().positive("duration must be positive"),
  format: z.string().min(1, "format is required"),
});

/**
 * Media can be either:
 * - images: array of image items
 * - video: single video object
 */
const mediaSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("images"),
    images: z.array(imageItemSchema).min(1, "At least one image is required"),
    video: z.undefined().optional(),
  }),
  z.object({
    kind: z.literal("video"),
    video: videoSchema,
    images: z.undefined().optional(),
  }),
]);



/**
 * Create post request schema.
 */
export const createPostSchema = z
  .object({
    action: z.enum(["draft", "publish"]),
    caption: z.string().max(5000, "Caption is too long").optional().default(""),
    hashtags: z.array(z.string().min(1)).optional().default([]),
    targets: targetsSchema,
    media: mediaSchema,
  })
  .superRefine((val, ctx) => {
    const targets = val.targets || {};

    const selectedPlatforms = Object.entries(targets)
      .filter(([_, v]) => v === true)
      .map(([k]) => k);

    // If publishing, at least one platform must be selected
    if (val.action === "publish" && selectedPlatforms.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["targets"],
        message: "Select at least one platform",
      });
    }

    // Images rules
    if (val.media.kind === "images") {
      // TikTok requires video
      if (targets.tiktok === true) {
        ctx.addIssue({
          code: "custom",
          path: ["media", "kind"],
          message: "TikTok requires a video",
        });
      }

      // YouTube requires video
      if (targets.youtube === true) {
        ctx.addIssue({
          code: "custom",
          path: ["media", "kind"],
          message: "YouTube requires a video",
        });
      }
    }

  });

/**
 * Valid MongoDB ObjectId param.
 */
export const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id"),
});