import { z } from "zod";

/**
 * ==============================
 * Login Validation Schema
 * ==============================
 * Validates login request body.
 */
const loginSchema = z.object({
  // Email must be a valid email format
  email: z.email({ message: "Invalid email" }),


  password: z.string().min(6),
});

export default loginSchema;