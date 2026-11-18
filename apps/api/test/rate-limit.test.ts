import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientIp, RateLimiter } from "../src/middleware/rate-limit.js";
import { request, startTestContext, type TestContext } from "./helpers.js";

const ip = (addr: string) => ({ headers: { "x-forwarded-for": `${addr}, 10.0.0.2` } });

function appWith(limiter: RateLimiter) {
  const app = new Hono();
  app.use("/t/*", limiter.middleware({ name: "t", windowMs: 60_000, max: 3 }));
  app.use("/w/*", limiter.middleware({ name: "w", windowMs: 60_000, max: 1, methods: ["POST"] }));
  app.all("*", (c) => c.text("ok"));
  return app;
}

describe("RateLimiter", () => {
  it("allows max requests per window per client, then answers 429 with Retry-After", async () => {
    let now = 1_000_000;
    const app = appWith(new RateLimiter(true, () => now));
    for (let i = 0; i < 3; i++) expect((await app.request("/t/x", ip("1.1.1.1"))).status).toBe(200);
    const limited = await app.request("/t/x", ip("1.1.1.1"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    // Someone else is not affected.
    expect((await app.request("/t/x", ip("2.2.2.2"))).status).toBe(200);
    // A new window starts afresh.
    now += 60_001;
    expect((await app.request("/t/x", ip("1.1.1.1"))).status).toBe(200);
  });

  it("counts only the listed methods", async () => {
    const app = appWith(new RateLimiter(true));
    expect((await app.request("/w/x", { method: "POST", ...ip("3.3.3.3") })).status).toBe(200);
    expect((await app.request("/w/x", ip("3.3.3.3"))).status).toBe(200);
    expect((await app.request("/w/x", { method: "POST", ...ip("3.3.3.3") })).status).toBe(429);
  });

  it("does nothing when disabled", async () => {
    const app = appWith(new RateLimiter(false));
    for (let i = 0; i < 10; i++)
      expect((await app.request("/t/x", ip("4.4.4.4"))).status).toBe(200);
  });

  it("reads the client from the first X-Forwarded-For entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 9.9.9.9 , 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("rate limits in the app", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await startTestContext({ RATE_LIMITS_ENABLED: "true" });
  });
  afterAll(async () => {
    await ctx?.stop();
  });

  it("limits guessing invite codes", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push(
        (
          await request(ctx.app, `/api/invites/guess-${i}`, {
            headers: { "x-forwarded-for": "5.5.5.5" },
          })
        ).status,
      );
    }
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
