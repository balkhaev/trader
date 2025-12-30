import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "../lib/logger";

/**
 * Custom application error with status code and optional error code
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, "NOT_FOUND");
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message, "UNAUTHORIZED");
  }
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message, "FORBIDDEN");
  }
}

/**
 * Bad request error (400)
 */
export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message, "BAD_REQUEST");
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, "CONFLICT");
  }
}

/**
 * Validation error (422)
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public errors?: Record<string, string[]>
  ) {
    super(422, message, "VALIDATION_ERROR");
  }
}

/**
 * Error response format
 */
interface ErrorResponse {
  error: string;
  code?: string;
  errors?: Record<string, string[]>;
  stack?: string;
}

/**
 * Global error handler middleware
 * Catches all errors and returns consistent JSON response
 */
export async function errorHandler(
  c: Context,
  next: Next
): Promise<Response | void> {
  try {
    await next();
  } catch (error) {
    // Handle AppError
    if (error instanceof AppError) {
      const response: ErrorResponse = {
        error: error.message,
        code: error.code,
      };

      if (error instanceof ValidationError && error.errors) {
        response.errors = error.errors;
      }

      logger.warn("Application error", {
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        path: c.req.path,
      });

      return c.json(
        response,
        error.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500
      );
    }

    // Handle Hono HTTPException
    if (error instanceof HTTPException) {
      logger.warn("HTTP exception", {
        status: error.status,
        message: error.message,
        path: c.req.path,
      });

      return c.json({ error: error.message, code: "HTTP_ERROR" }, error.status);
    }

    // Handle unknown errors
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const stack = error instanceof Error ? error.stack : undefined;

    logger.error("Unhandled error", {
      message,
      stack,
      path: c.req.path,
      method: c.req.method,
    });

    const response: ErrorResponse = {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    };

    // Include stack trace in development
    if (process.env.NODE_ENV === "development" && stack) {
      response.stack = stack;
    }

    return c.json(response, 500);
  }
}

/**
 * Not found handler for unmatched routes
 */
export function notFoundHandler(c: Context): Response {
  return c.json({ error: "Route not found", code: "NOT_FOUND" }, 404);
}
