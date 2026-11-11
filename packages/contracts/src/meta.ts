import { z } from "zod";

export const MetaResponseSchema = z.object({
  version: z.string(),
  features: z.object({
    googleSignIn: z.boolean(),
  }),
});
export type MetaResponse = z.infer<typeof MetaResponseSchema>;
