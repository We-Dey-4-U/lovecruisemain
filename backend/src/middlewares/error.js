/**
 * ============================================================
 * backend/src/middlewares/errorHandler.js
 * ------------------------------------------------------------
 * Global 404 + Error Handler
 * ============================================================
 */

// 404 Handler
function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.originalUrl}`,
  });
}

// Global Error Handler
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Always log the full error on the server
  console.error(`[${req.method} ${req.originalUrl}] ERROR:`, err);

  // Respect controller-defined status codes.
  // Default to 500 if none was provided.
  const status = Number.isInteger(err.status) ? err.status : 500;

  // If the controller intentionally set a status (400,403,404,etc.)
  // return its message. Otherwise hide unexpected internal errors
  // in production.
  const message =
    err.status
      ? err.message
      : process.env.NODE_ENV === "production"
      ? "Something went wrong. Please try again."
      : err.message || "Internal server error";

  const response = {
    success: false,
    message,
  };

  // Include stack trace only during development
  if (process.env.NODE_ENV !== "production") {
    response.stack = err.stack;
  }

  res.status(status).json(response);
}

module.exports = {
  notFound,
  errorHandler,
};