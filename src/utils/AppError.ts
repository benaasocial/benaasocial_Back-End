
/**
 * ==============================
 * Custom Application Error Class
 * ==============================
 * 
 * Extends the native Error class.
 * Used to create consistent, structured errors
 * across the entire application.
 */



// Define the AppError class to handle errors in the application
class AppError extends Error {
    // Define the status property
    statusCode: number;
    // Define the errors property
    errors?: any[];

    code?: string;

    // Call the constructor of the parent class (Error) with the error message

    constructor(message: string, statusCode: number, errors?: any[], code?: string) {
        super(message);
        // Assign custom properties
        this.statusCode = statusCode;
        this.errors = errors;
        this.code = code;
    }
}

export default AppError;
