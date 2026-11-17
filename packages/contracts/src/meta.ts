import { z } from "zod";

export const MetaResponseSchema = z.object({
  version: z.string(),
  features: z.object({
    googleSignIn: z.boolean(),
    /** Real photo uploads; off when no bucket is configured or the server runs in demo mode. */
    receiptUploads: z.boolean(),
    /** Built-in sample receipts; available whenever receipt storage is configured. */
    receiptSamples: z.boolean(),
  }),
  limits: z.object({
    /** Photo uploads each user may start per rolling 24 hours. */
    receiptScansPerDay: z.number().int().nonnegative(),
  }),
});
export type MetaResponse = z.infer<typeof MetaResponseSchema>;
