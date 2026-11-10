import { z } from "zod";

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    APP_VERSION: z.string().default("dev"),

    /** Public origin of the web app; used for links in emails and as the auth base URL origin. */
    APP_URL: z.url().default("http://localhost:3000"),
    /** Extra origins allowed to call the API with credentials (the web app origin is always allowed). */
    CORS_ORIGINS: z
      .string()
      .default("")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "must be at least 32 characters (openssl rand -base64 32)"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    EMAIL_TRANSPORT: z.enum(["smtp", "ses", "log"]).optional(),
    EMAIL_FROM: z.string().default("BillSplit <no-reply@localhost>"),
    /** smtp://host:port (Mailpit locally). */
    SMTP_URL: z.string().default("smtp://localhost:1025"),
    AWS_REGION: z.string().optional(),
  })
  .transform((e) => ({
    ...e,
    EMAIL_TRANSPORT:
      e.EMAIL_TRANSPORT ?? (e.NODE_ENV === "production" ? ("ses" as const) : ("smtp" as const)),
    CORS_ORIGINS: Array.from(new Set([e.APP_URL, ...e.CORS_ORIGINS])),
  }));

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}
