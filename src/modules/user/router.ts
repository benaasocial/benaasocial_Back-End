import express from "express";
import authenticate from "../../middleware/auth";
import { createUser, deleteUser, getAllUsers } from "./controller";
import authorize from "../../middleware/authorization";
import validate from "../../middleware/validate";
import {createUserSchema, idParamSchema} from "./validation";
import ApiError from "../../middleware/ApiError";

const router = express.Router();

/**
 * ==============================
 * Users Routes (Owner Only)
 * ==============================
 * All routes are protected:
 * - authenticate: requires valid JWT
 * - authorize("owner"): requires owner role
 */

router.get("/", authenticate, authorize("owner"), ApiError(getAllUsers));

// Validate request body before creating user
router.post("/", authenticate, authorize("owner"), validate(createUserSchema), ApiError(createUser) );

router.delete("/:id", authenticate, authorize("owner"), validate(idParamSchema), ApiError(deleteUser));

export default router;