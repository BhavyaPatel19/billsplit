import { describe, expect, it } from "vitest";
import type { ReceiptClaim } from "@billsplit/contracts";
import { estimateShare, lineShares, unclaimedCount } from "./claim-share";

const claim = (itemIndex: number, participantId: string, percent: number | null = null) =>
  ({ itemIndex, participantId, percent }) satisfies ReceiptClaim;

const page = {
  items: [
    { index: 0, description: "Margherita", quantity: 1, totalPriceCents: 1800 },
    { index: 1, description: "Tiramisu", quantity: 1, totalPriceCents: 900 },
    { index: 2, description: "Water", quantity: 1, totalPriceCents: 400 },
  ],
  taxCents: 250,
  tipCents: 600,
  feeCents: null,
  discountCents: 230,
};

describe("lineShares", () => {
  it("splits a line equally and keeps every cent", () => {
    const shares = lineShares(1000, [claim(0, "a"), claim(0, "b"), claim(0, "c")]);
    expect([...shares.values()]).toEqual([334, 333, 333]);
  });

  it("takes percent claims first and shares the rest equally", () => {
    const shares = lineShares(900, [claim(1, "bite", 10), claim(1, "a"), claim(1, "b")]);
    expect(Object.fromEntries(shares)).toEqual({ bite: 90, a: 405, b: 405 });
  });

  it("leaves the remainder unassigned when only percent claims exist", () => {
    expect(Object.fromEntries(lineShares(900, [claim(1, "bite", 10)]))).toEqual({ bite: 90 });
  });
});

describe("estimateShare", () => {
  it("adds a proportional part of tax and tip, less discounts", () => {
    const claims = [claim(0, "a"), claim(0, "b"), claim(1, "a", 10), claim(2, "b")];
    // a: 900 + 90 = 990 of 3100 in items; extras are 250 + 600 - 230 = 620.
    expect(estimateShare(page, claims, "a")).toEqual({
      itemsCents: 990,
      extrasCents: 198,
      totalCents: 1188,
    });
    expect(estimateShare(page, claims, "nobody").totalCents).toBe(0);
  });

  it("is zero for an empty receipt", () => {
    expect(estimateShare({ ...page, items: [] }, [], "a").totalCents).toBe(0);
  });
});

describe("unclaimedCount", () => {
  it("counts lines nobody tapped", () => {
    expect(unclaimedCount(page, [])).toBe(3);
    expect(unclaimedCount(page, [claim(0, "a"), claim(0, "b"), claim(2, "a")])).toBe(1);
  });
});
