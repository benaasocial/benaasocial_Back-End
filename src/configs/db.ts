import mongoose from "mongoose";
import logger from "../utils/logger";
import dotenv from "dotenv";

// Load environment variables
// Ensures MONGO_URI is available before using it
dotenv.config();

/**
 * ==============================
 * MongoDB Connection Setup
 * ==============================
 * 
 * Reads the MongoDB connection string from environment variables.
 * Throws an error immediately if not defined (Fail Fast principle).
 */

const mongoUri = process.env.MONGO_URI;

// Validate that MONGO_URI exists
// Prevents undefined being passed to mongoose.connect()
if (!mongoUri) {
  throw new Error("MONGO_URI is not defined");
}

/**
 * Connect to MongoDB using Mongoose.
 * 
 * - If connection succeeds → server continues normally.
 * - If connection fails → log error and exit process.
 * 
 * Exiting prevents the app from running without a database.
 */
const connectDB = async (): Promise<void> => {
  try {
    // Attempt database connection
    await mongoose.connect(mongoUri);

    // Log successful connection
    logger.info("Connected to MongoDB");

  } catch (error) {
    // Log structured error for debugging
    logger.error("MongoDB connection failed", { error });

    // Exit application with failure code
    // This ensures we don't run the server without DB
    process.exit(1);
  }
};

export default connectDB;