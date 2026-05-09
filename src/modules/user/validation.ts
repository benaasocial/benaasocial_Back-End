import { z } from "zod";


// Define the user schema
export const createUserSchema = z.object({
  username: z.string().min(3),
  email: z.email(),
  role: z.enum(["owner", "user"]),
  password: z.string().min(6),
});


// Define the id param schema
export const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id"),
});