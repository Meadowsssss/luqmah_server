const { env } = require("../config/env");
const { isZodError } = require("./validate");
const { ApiError } = require("../utils/api-error");

const notFoundHandler = (req, _res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

const errorHandler = (error, _req, res, _next) => {
  if (isZodError(error)) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      errors: error.flatten(),
    });
  }

  const statusCode = error.statusCode || 500;
  const payload = {
    code:
      error.code ||
      (statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED"),
    message: error.message || "Internal server error",
  };

  if (error.details) {
    payload.details = error.details;
  }

  if (env.NODE_ENV !== "production" && statusCode >= 500 && error.stack) {
    payload.debug = error.stack;
  }

  return res.status(statusCode).json(payload);
};

module.exports = { notFoundHandler, errorHandler };
