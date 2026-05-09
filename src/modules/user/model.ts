import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { IUser } from "../../types/user";
import jwt from "jsonwebtoken";

/**
 * ==============================
 * User Schema
 * ==============================
 * - Stores user credentials and role.
 * - Password is hashed automatically before saving/updating.
 */

const schema = new mongoose.Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["owner", "user"],
      default: "user",
      required: true,
    },
    password: {
      type: String,
      select: false,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const salt = Number(process.env.SALT_ROUNDS);

if (!salt) {
  throw new Error("SALT_ROUNDS is not defined");
}


/**
 * Hash password before saving (create / save).
 * Only hashes when password is modified.
 */
schema.pre<IUser>("save", async function () {
  if (!this.isModified("password")) return;

  // Hash password with bcrypt (salt rounds = 10)
  this.password = await bcrypt.hash(this.password, salt);
});

/**
 * Hash password on findOneAndUpdate as well.
 * Supports both direct updates and $set updates.
 */
schema.pre("findOneAndUpdate", async function () {
  const update: any = this.getUpdate();

  const newPassword = update?.password || update?.$set?.password;

  if (newPassword) {
    const hashed = await bcrypt.hash(newPassword, salt);

    // Write back to the correct place
    if (update.password) update.password = hashed;
    if (update.$set?.password) update.$set.password = hashed;

    this.setUpdate(update);
  }
});

/**
 * Compare plain password with hashed password stored in DB.
 */
schema.methods.comparePassword = async function (candidatePassword: string) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Generate JWT token for authenticated user.
 * Payload is minimal: user id + role.
 */
schema.methods.generateToken = async function () {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");

  return jwt.sign(
    { _id: this._id, role: this.role },
    secret,
    { expiresIn: "7d" }
  );
};

const User: mongoose.Model<IUser> = mongoose.model<IUser>("User", schema);
export default User;