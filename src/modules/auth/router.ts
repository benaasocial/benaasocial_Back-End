import express from "express";
import { getMe, loginController } from "./controller";
import validate from "../../middleware/validate";
import loginSchema from "./validation";
import authenticate from "../../middleware/auth";


const router = express.Router();


/**
 * ==============================
 * Auth Routes
 * ==============================
 *
 * - POST /login: Validates credentials and returns token.
 * - GET  /me   : Returns current user profile (requires authentication).
 */




// Login route (validate request body before controller)
router.post("/login", validate(loginSchema), loginController);

// Current user route (protected by JWT authentication middleware)
router.get("/me", authenticate, getMe);






export default router;