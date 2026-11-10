import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { schema, type Db } from "@billsplit/db";
import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import type { Mailer } from "./email.js";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";

export interface AuthDeps {
  env: Env;
  db: Db;
  mailer: Mailer;
  logger: Logger;
}

// OWASP-recommended Argon2id parameters (64 MiB, 3 passes).
const ARGON2 = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
  algorithm: 2, // Argon2id (const enum; cannot be imported under verbatimModuleSyntax)
};

/**
 * Better Auth instance, mounted at `<APP_URL>/api/auth/*` so cookies stay first-party on the
 * app origin (the web app proxies /api to this service).
 */
export function createAuth({ env, db, mailer, logger }: AuthDeps) {
  const sendOrLog = (label: string, promise: Promise<void>) => {
    // Never await email delivery inside the auth flow: keeps response times uniform so an
    // attacker cannot tell whether an address exists from latency.
    promise.catch((err: unknown) => logger.error({ err, label }, "email delivery failed"));
  };

  return betterAuth({
    appName: "BillSplit",
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.CORS_ORIGINS,
    logger: {
      disabled: false,
      level: env.NODE_ENV === "production" ? "warn" : "info",
      log: (level, message, ...args) => {
        const fn = level === "error" ? logger.error : level === "warn" ? logger.warn : logger.info;
        fn.call(logger, { args }, `[auth] ${message}`);
      },
    },

    database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
      sendResetPassword: ({ user, url }) =>
        Promise.resolve(
          sendOrLog(
            "reset-password",
            mailer.send({
              to: user.email,
              subject: "Reset your BillSplit password",
              text: `Hi ${user.name},\n\nReset your password here (link valid for one hour):\n${url}\n\nIf you did not ask for this, ignore this email.`,
              html: `<p>Hi ${escapeHtml(user.name)},</p><p><a href="${url}">Reset your password</a> (link valid for one hour).</p><p>If you did not ask for this, ignore this email.</p>`,
            }),
          ),
        ),
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: ({ user, url }) =>
        Promise.resolve(
          sendOrLog(
            "verify-email",
            mailer.send({
              to: user.email,
              subject: "Verify your email for BillSplit",
              text: `Hi ${user.name},\n\nConfirm your email to start splitting bills:\n${url}\n\nThe link is valid for 24 hours.`,
              html: `<p>Hi ${escapeHtml(user.name)},</p><p><a href="${url}">Confirm your email</a> to start splitting bills. The link is valid for 24 hours.</p>`,
            }),
          ),
        ),
    },

    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // No cookie cache: every request checks the database so sign-out and revocation apply at once.
      cookieCache: { enabled: false },
    },

    rateLimit: {
      enabled: env.NODE_ENV === "production",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
      },
    },

    advanced: {
      cookiePrefix: "billsplit",
      // Caddy (prod) and the Next.js rewrite (dev) both set X-Forwarded-For; Caddy only trusts
      // the header from private ranges, so clients cannot spoof it.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      useSecureCookies: env.APP_URL.startsWith("https://"),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
