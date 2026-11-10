import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadinessCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

export const ReadinessResponseSchema = z.object({
  status: z.enum(["ready", "degraded"]),
  checks: z.array(ReadinessCheckSchema),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
