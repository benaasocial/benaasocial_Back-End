import express from "express";
import authenticate from "../../middleware/auth";
import validate from "../../middleware/validate";
import {
  createPost,
  deletePost,
  getAllPosts,
  retryPublishPost,
} from "./controller";
import { createPostSchema, idParamSchema } from "./validation";
import ApiError from "../../middleware/ApiError";

const router = express.Router();

// All post routes require authentication
router.use(authenticate);

router.post("/", validate(createPostSchema), ApiError(createPost));
router.get("/", ApiError(getAllPosts));
router.post("/:id/retry", validate(idParamSchema), ApiError(retryPublishPost));
router.delete("/:id", validate(idParamSchema), ApiError(deletePost));


export default router;