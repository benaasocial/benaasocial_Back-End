import { z } from "zod";

export const setActiveSchema = z.object({
  platform: z.enum(["facebook", "instagram", "tiktok", "youtube"]),
  active: z.coerce.boolean(),
});