import type { MiddlewareHandler } from "hono";

export interface RateLimitRule {
  /** Groups counters, so two rules on one path count separately. */
  name: string;
  windowMs: number;
  max: number;
  /** Only count these methods (all when omitted). */
  methods?: readonly string[];
}

/**
 * The client's address. Caddy (production) and the Next.js rewrite (development) set
 * X-Forwarded-For, and Caddy replaces whatever an untrusted client sent, so the first entry is
 * the client. Same rule as Better Auth's own limiter.
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Fixed-window counters per client and rule, in memory. Enough for the single host this runs on
 * (ADR 0002); with several API instances each would allow `max`, so move the counters to Valkey
 * then. Over the limit: 429 with Retry-After.
 */
export class RateLimiter {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  middleware(rule: RateLimitRule): MiddlewareHandler {
    return async (c, next) => {
      if (!this.enabled || (rule.methods && !rule.methods.includes(c.req.method))) return next();
      const now = this.now();
      this.sweep(now);
      const key = `${rule.name}:${clientIp(c.req.raw.headers)}`;
      let entry = this.counters.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + rule.windowMs };
        this.counters.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > rule.max) {
        const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        c.header("Retry-After", String(retryAfter));
        return c.json({ error: "Too many requests. Try again in a minute." }, 429);
      }
      return next();
    };
  }

  /** Drop expired counters at most once a minute so memory stays bounded. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, entry] of this.counters) if (entry.resetAt <= now) this.counters.delete(key);
  }
}
