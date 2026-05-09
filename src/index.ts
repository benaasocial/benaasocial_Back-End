import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./configs/db";
import AppError from "./utils/AppError";
import globalErrorHandler from "./middleware/globalError";
import bootstrap from "./modules/bootstrap";
import requestId from "./middleware/requestId";
import logger from "./utils/logger";


// Load environment variables from .env file
// Must be called before using process.env anywhere in the app
dotenv.config();


// Use provided PORT or fallback to 8000
// Convert to number to avoid type issues
const port = Number(process.env.PORT) || 8000;


// Create Express application instance
const app = express();

// Set security HTTP headers
app.use(helmet());

// Parse incoming JSON requests
// Limit body size to prevent abuse (basic DoS protection)
app.use(express.json({ limit: "10kb" }));



/**
 * ==============================
 * CORS Configuration
 * ==============================
 * 
 * Read allowed origins from environment variable.
 * Supports multiple origins separated by commas.
 * Example:
 * CORS_ORIGINS=http://localhost:3000,https://myapp.com
 */

const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
    : [];


// Apply CORS middleware
// If no origins defined → allow all (use carefully in production)
app.use(
    cors({
        origin: corsOrigins.length ? corsOrigins : true,
    })
);



/**
 * ==============================
 * Request ID Middleware
 * ==============================
 * 
 * Attaches a unique ID to each request.
 * Useful for logging and debugging.
 */
app.use(requestId);


/**
 * ==============================
 * Register Application Routes
 * ==============================
 */

bootstrap(app);


/**
 * ==============================
 * Handle Unknown Routes (404)
 * ==============================
 * 
 * Any request that reaches here did not match a route.
 * Forward to global error handler using AppError.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
    next(new AppError("Route not found", 404));
});


/**
 * ==============================
 * Global Error Handler
 * ==============================
 * 
 * Centralized error handling middleware.
 */
app.use(globalErrorHandler);

/**
 * ==============================
 * Start Server After DB Connection
 * ==============================
 * 
 * Ensure database is connected before accepting requests.
 * Prevents runtime errors if DB is not ready.
 */
(async () => {
    await connectDB();
    app.listen(port, () => logger.info(`Server listening on port ${port}`));
})();