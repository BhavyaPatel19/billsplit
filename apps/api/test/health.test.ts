import { describe, expect, it } from "vitest";
import pino from "pino";
import { HealthResponseSchema, ReadinessResponseSchema } from "@billsplit/contracts";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";

function testApp() {
  const env = loadEnv({ NODE_ENV: "test", APP_VERSION: "test-sha" });
  return createApp({ env, logger: pino({ enabled: false }) });
}

describe("GET /healthz", () => {
  it("returns a valid liveness payload", async () => {
    const res = await testApp().request("/healthz");
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.service).toBe("billsplit-api");
    expect(body.version).toBe("test-sha");
  });

  it("sets a request id header", async () => {
    const res = await testApp().request("/healthz");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("GET /readyz", () => {
  it("is ready when there are no failing probes", async () => {
    const res = await testApp().request("/readyz");
    expect(res.status).toBe(200);
    const body = ReadinessResponseSchema.parse(await res.json());
    expect(body.status).toBe("ready");
  });
});

describe("OpenAPI", () => {
  it("documents the health routes", async () => {
    const res = await testApp().request("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/healthz", "/readyz"]));
  });
});

describe("unknown routes", () => {
  it("returns a JSON 404", async () => {
    const res = await testApp().request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});

describe("env", () => {
  it("rejects an invalid PORT", () => {
    expect(() => loadEnv({ PORT: "not-a-port" })).toThrow(/PORT/);
  });
});
