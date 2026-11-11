import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Domain error that the global error handler turns into `{ error, details }` JSON. Prefer the
 * named helpers; `notFound` is also used for resources the caller may not know exist, so a
 * non-member probing group ids gets the same answer as for a missing group.
 */
export class ApiError extends HTTPException {
  readonly details: unknown;
  constructor(status: ContentfulStatusCode, message: string, details?: unknown) {
    super(status, { message });
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, details);
export const forbidden = (message = "You do not have permission to do that") =>
  new ApiError(403, message);
export const notFound = (message = "Not found") => new ApiError(404, message);
export const conflict = (message: string) => new ApiError(409, message);
export const gone = (message: string) => new ApiError(410, message);
