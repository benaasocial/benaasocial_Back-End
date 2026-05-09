import { Document } from "mongoose";
import { JwtPayload } from "jsonwebtoken";

// Define the user interface
export interface IUser extends Document {
  username: string;
  email: string;
  role: "owner" | "user";
  password: string;
  comparePassword(candidatePassword: string): Promise<boolean>;
  generateToken(): Promise<string>;
}


// Define the user payload interface from jwt
export interface IUserPayload extends JwtPayload {
  _id: string;
  role: "owner" | "user";
}
