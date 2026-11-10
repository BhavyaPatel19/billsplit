import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MeResponseSchema } from "@billsplit/contracts";
import { cookiesOf, firstUrl, jsonRequest, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContext();
});

afterAll(async () => {
  await ctx?.stop();
});

const ana = { name: "Ana", email: "ana@example.com", password: "correct horse battery" };

describe("email + password sign-up", () => {
  it("creates the account and sends a verification email", async () => {
    const res = await jsonRequest(ctx.app, "/api/auth/sign-up/email", { body: ana });
    expect(res.status).toBe(200);
    const mail = ctx.mailer.lastTo(ana.email);
    expect(mail?.subject).toMatch(/verify/i);
    expect(mail?.text).toContain("http://localhost:3000/api/auth/verify-email?token=");
  });

  it("refuses to sign in before the email is verified", async () => {
    const res = await jsonRequest(ctx.app, "/api/auth/sign-in/email", {
      body: { email: ana.email, password: ana.password },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  it("rejects short passwords", async () => {
    const res = await jsonRequest(ctx.app, "/api/auth/sign-up/email", {
      body: { name: "Bo", email: "bo@example.com", password: "short" },
    });
    expect(res.status).toBe(400);
  });

  it("verifies through the emailed link and signs the user in", async () => {
    const url = firstUrl(ctx.mailer.lastTo(ana.email)!.text);
    const path = url.replace("http://localhost:3000", "");
    const res = await ctx.app.request(path, { headers: { origin: "http://localhost:3000" } });
    expect([200, 302]).toContain(res.status);
    const cookie = cookiesOf(res);
    expect(cookie).toContain("billsplit.session_token=");

    const me = await jsonRequest(ctx.app, "/api/me", { cookie });
    expect(me.status).toBe(200);
    const body = MeResponseSchema.parse(await me.json());
    expect(body.user).toMatchObject({ name: "Ana", email: ana.email, emailVerified: true });
  });

  it("signs in with the password after verification and signs out", async () => {
    const res = await jsonRequest(ctx.app, "/api/auth/sign-in/email", {
      body: { email: ana.email, password: ana.password },
    });
    expect(res.status).toBe(200);
    const cookie = cookiesOf(res);
    expect((await jsonRequest(ctx.app, "/api/me", { cookie })).status).toBe(200);

    const out = await jsonRequest(ctx.app, "/api/auth/sign-out", { body: {}, cookie });
    expect(out.status).toBe(200);
    expect((await jsonRequest(ctx.app, "/api/me", { cookie })).status).toBe(401);
  });

  it("rejects a wrong password without revealing which part was wrong", async () => {
    const res = await jsonRequest(ctx.app, "/api/auth/sign-in/email", {
      body: { email: ana.email, password: "not the password" },
    });
    expect(res.status).toBe(401);
    const unknown = await jsonRequest(ctx.app, "/api/auth/sign-in/email", {
      body: { email: "nobody@example.com", password: "not the password" },
    });
    expect(unknown.status).toBe(401);
  });

  it("stores an argon2id hash, never the password", async () => {
    const rows = await ctx.db.db.query.accounts.findMany();
    const credential = rows.find((a) => a.providerId === "credential");
    expect(credential?.password).toMatch(/^\$argon2id\$/);
  });
});

describe("password reset", () => {
  it("emails a reset link and accepts the new password", async () => {
    const req = await jsonRequest(ctx.app, "/api/auth/request-password-reset", {
      body: { email: ana.email, redirectTo: "http://localhost:3000/reset-password" },
    });
    expect(req.status).toBe(200);
    const url = firstUrl(ctx.mailer.lastTo(ana.email)!.text);
    // Better Auth puts the token in the path: /api/auth/reset-password/<token>?callbackURL=...
    const token = /reset-password\/([^?]+)/.exec(url)?.[1];
    expect(token).toBeTruthy();

    const reset = await jsonRequest(ctx.app, "/api/auth/reset-password", {
      body: { token, newPassword: "a brand new passphrase" },
    });
    expect(reset.status).toBe(200);

    const signIn = await jsonRequest(ctx.app, "/api/auth/sign-in/email", {
      body: { email: ana.email, password: "a brand new passphrase" },
    });
    expect(signIn.status).toBe(200);
  });
});

describe("anonymous access", () => {
  it("/me is 401 with a JSON body", async () => {
    const res = await jsonRequest(ctx.app, "/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Sign in required" });
  });

  it("CORS: credentials are only allowed for the app origin", async () => {
    const evil = await ctx.app.request("/api/me", { headers: { origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const ours = await ctx.app.request("/api/me", { headers: { origin: "http://localhost:3000" } });
    expect(ours.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(ours.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
