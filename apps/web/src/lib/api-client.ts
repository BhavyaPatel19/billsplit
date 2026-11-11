"use client";

import { ErrorResponseSchema } from "@billsplit/contracts";
import type { z } from "zod";

/** Thrown for non-2xx responses; `message` is the API's human-readable error. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * Browser-side call to the same-origin API with cookies, parsed and validated against a
 * contract schema.
 */
export async function api<S extends z.ZodType>(
  path: string,
  schema: S,
  init: { method?: string; body?: unknown } = {},
): Promise<z.infer<S>> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : {},
    credentials: "same-origin",
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 204) return undefined as z.infer<S>;
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const parsed = ErrorResponseSchema.safeParse(json);
    throw new ApiClientError(
      res.status,
      parsed.success ? parsed.data.error : `Request failed (${res.status})`,
      parsed.success ? parsed.data.details : undefined,
    );
  }
  return schema.parse(json) as z.infer<S>;
}
