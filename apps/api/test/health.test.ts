import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HealthResponseSchema, ReadinessResponseSchema } from "@billsplit/contracts";
import { loadEnv } from "../src/env.js";
import { startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestContext();
});

afterAll(async () => {
  await ctx?.stop();
});

describe("GET /healthz", () => {
  it("returns a valid liveness payload", async () => {
    const res = await ctx.app.request("/api/healthz");
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.service).toBe("billsplit-api");
    expect(body.version).toBe("test-sha");
  });

  it("sets a request id header", async () => {
    const res = await ctx.app.request("/api/healthz");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("GET /readyz", () => {
  it("is ready when postgres answers", async () => {
    const res = await ctx.app.request("/api/readyz");
    expect(res.status).toBe(200);
    const body = ReadinessResponseSchema.parse(await res.json());
    expect(body.status).toBe("ready");
    expect(body.checks).toEqual([expect.objectContaining({ name: "postgres", ok: true })]);
  });
});

describe("OpenAPI", () => {
  it("documents the health and account routes", async () => {
    const res = await ctx.app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/api/healthz", "/api/readyz", "/api/me"]),
    );
  });
});

describe("unknown routes", () => {
  it("returns a JSON 404", async () => {
    const res = await ctx.app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});

describe("env", () => {
  const base = {
    DATABASE_URL: "postgresql://x:y@localhost:5432/z",
    BETTER_AUTH_SECRET: "0123456789012345678901234567890123456789",
  };

  it("rejects an invalid PORT", () => {
    expect(() => loadEnv({ ...base, PORT: "not-a-port" })).toThrow(/PORT/);
  });

  it("requires a long auth secret", () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("always trusts the app origin and picks the email transport per environment", () => {
    const dev = loadEnv({ ...base, CORS_ORIGINS: "http://localhost:5173" });
    expect(dev.CORS_ORIGINS).toEqual(["http://localhost:3000", "http://localhost:5173"]);
    expect(dev.EMAIL_TRANSPORT).toBe("smtp");
    expect(loadEnv({ ...base, NODE_ENV: "production" }).EMAIL_TRANSPORT).toBe("ses");
  });
});
