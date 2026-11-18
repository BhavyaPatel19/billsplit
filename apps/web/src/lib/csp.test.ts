import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `));

describe("buildCsp", () => {
  it("only runs scripts carrying this request's nonce in production", () => {
    const csp = buildCsp({
      nonce: "abc",
      dev: false,
      receiptsOrigin: "https://b.s3.us-west-2.amazonaws.com",
    });
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(directive(csp, "img-src")).toBe(
      "img-src 'self' data: blob: https://b.s3.us-west-2.amazonaws.com",
    );
    expect(directive(csp, "connect-src")).toBe(
      "connect-src 'self' https://b.s3.us-west-2.amazonaws.com",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows React Refresh in development", () => {
    const csp = buildCsp({ nonce: "n", dev: true, receiptsOrigin: "http://localhost:9000" });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' http://localhost:9000 ws:");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
