import express from "express";
import authenticate from "../../middleware/auth";
import {
  getConnectionsStatus,
  metaCallback,
  metaPages,
  metaSelectPage,
  metaStartUrl,
  setPlatformActive,
  tiktokCallback,
  tiktokStartUrl,
  youtubeCallback,
  youtubeChannel,
  youtubeStartUrl,
} from "./controller";
import ApiError from "../../middleware/ApiError";
import validate from "../../middleware/validate";
import { setActiveSchema } from "./validation";

const router = express.Router();

/**
 * Meta OAuth flow
 */
router.get("/meta/start", authenticate, ApiError(metaStartUrl));
router.get("/meta/callback", ApiError(metaCallback));

router.get("/meta/pages", authenticate, ApiError(metaPages));
router.post("/meta/select-page", authenticate, metaSelectPage);

/**
 * TikTok OAuth flow
 */
router.get("/tiktok/start", authenticate, ApiError(tiktokStartUrl));
router.get("/tiktok/callback", ApiError(tiktokCallback));



/**
 * Youtube OAuth flow
 */



router.get("/youtube/start", authenticate, ApiError(youtubeStartUrl));
router.get("/youtube/callback", ApiError(youtubeCallback));
router.get("/youtube/channel", authenticate, ApiError(youtubeChannel));







/**
 * Connected accounts management
 */
router.patch(
  "/connected-accounts/:platform/active",
  authenticate,
  validate(setActiveSchema),
  ApiError(setPlatformActive)
);

router.get(
  "/connected-accounts/status",
  authenticate,
  ApiError(getConnectionsStatus)
);

export default router;