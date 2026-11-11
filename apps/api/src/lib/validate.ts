import { validator as openApiValidator } from "hono-openapi";
import type { ValidationTargets } from "hono";
import type { z } from "zod";
import { badRequest } from "./errors.js";

/**
 * Zod validation for a request target that also documents the schema in OpenAPI. Failures
 * become a 400 with the flattened issues, instead of hono-openapi's default response.
 */
export function validate<T extends keyof ValidationTargets, S extends z.ZodType>(
  target: T,
  schema: S,
) {
  return openApiValidator(target, schema, (result) => {
    if (!result.success) {
      throw badRequest(
        "Invalid request",
        result.error.map((issue) => ({ path: issue.path, message: issue.message })),
      );
    }
  });
}
