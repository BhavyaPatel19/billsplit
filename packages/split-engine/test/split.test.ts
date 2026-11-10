import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  assertUniqueParticipants,
  cents,
  PERCENT_TOLERANCE,
  splitAmount,
  splitParticipants,
  SplitError,
  type Split,
} from "../src/index.js";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof SplitError ? e.code : "not-a-split-error";
  }
}

describe("splitAmount", () => {
  it("equal", () => {
    expect(splitAmount(cents(10000), { kind: "equal", participantIds: ["a", "b", "c"] })).toEqual({
      a: 3334,
      b: 3333,
      c: 3333,
    });
  });

  it("exact", () => {
    expect(
      splitAmount(cents(1000), {
        kind: "exact",
        amounts: [
          { participantId: "a", amount: cents(250) },
          { participantId: "b", amount: cents(750) },
        ],
      }),
    ).toEqual({ a: 250, b: 750 });
  });

  it("exact must add up", () => {
    expect(
      code(() =>
        splitAmount(cents(1000), {
          kind: "exact",
          amounts: [{ participantId: "a", amount: cents(999) }],
        }),
      ),
    ).toBe("EXACT_SUM_MISMATCH");
  });

  it("percent with a 10% bite", () => {
    expect(
      splitAmount(cents(2400), {
        kind: "percent",
        percents: [
          { participantId: "a", percent: 90 },
          { participantId: "b", percent: 10 },
        ],
      }),
    ).toEqual({ a: 2160, b: 240 });
  });

  it("percent tolerates float noise but not a real shortfall", () => {
    const noisy: Split = {
      kind: "percent",
      percents: [
        { participantId: "a", percent: 33.333333 },
        { participantId: "b", percent: 33.333333 },
        { participantId: "c", percent: 33.333334 },
      ],
    };
    expect(splitAmount(cents(300), noisy)).toEqual({ a: 100, b: 100, c: 100 });
    const short: Split = {
      kind: "percent",
      percents: [
        { participantId: "a", percent: 50 },
        { participantId: "b", percent: 49 },
      ],
    };
    expect(code(() => splitAmount(cents(100), short))).toBe("PERCENT_SUM_MISMATCH");
    expect(PERCENT_TOLERANCE).toBe(1e-6);
  });

  it("percent rejects negative or non-finite percentages", () => {
    const bad: Split = {
      kind: "percent",
      percents: [
        { participantId: "a", percent: 150 },
        { participantId: "b", percent: -50 },
      ],
    };
    expect(code(() => splitAmount(cents(100), bad))).toBe("INVALID_PERCENT");
  });

  it("shares", () => {
    expect(
      splitAmount(cents(900), {
        kind: "shares",
        shares: [
          { participantId: "couple", shares: 2 },
          { participantId: "single", shares: 1 },
        ],
      }),
    ).toEqual({ couple: 600, single: 300 });
  });

  it("shares keeps zero-share participants with a zero", () => {
    expect(
      splitAmount(cents(900), {
        kind: "shares",
        shares: [
          { participantId: "a", shares: 1 },
          { participantId: "b", shares: 0 },
        ],
      }),
    ).toEqual({ a: 900, b: 0 });
  });

  it("shares rejects fractional or negative counts", () => {
    expect(
      code(() =>
        splitAmount(cents(1), { kind: "shares", shares: [{ participantId: "a", shares: 1.5 }] }),
      ),
    ).toBe("INVALID_SHARES");
    expect(
      code(() =>
        splitAmount(cents(1), { kind: "shares", shares: [{ participantId: "a", shares: -1 }] }),
      ),
    ).toBe("INVALID_SHARES");
  });

  it("rejects empty and duplicate participants", () => {
    expect(code(() => splitAmount(cents(1), { kind: "equal", participantIds: [] }))).toBe(
      "EMPTY_PARTICIPANTS",
    );
    expect(code(() => splitAmount(cents(1), { kind: "equal", participantIds: ["a", "a"] }))).toBe(
      "DUPLICATE_PARTICIPANT",
    );
    expect(code(() => assertUniqueParticipants([]))).toBe("EMPTY_PARTICIPANTS");
    expect(assertUniqueParticipants(["x", "y"])).toEqual(["x", "y"]);
  });

  it("splitParticipants lists ids in split order for every kind", () => {
    expect(splitParticipants({ kind: "equal", participantIds: ["b", "a"] })).toEqual(["b", "a"]);
    expect(
      splitParticipants({ kind: "exact", amounts: [{ participantId: "z", amount: cents(1) }] }),
    ).toEqual(["z"]);
    expect(
      splitParticipants({ kind: "percent", percents: [{ participantId: "p", percent: 100 }] }),
    ).toEqual(["p"]);
    expect(
      splitParticipants({ kind: "shares", shares: [{ participantId: "s", shares: 1 }] }),
    ).toEqual(["s"]);
  });
});

const ids = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 1, maxLength: 8 });
const amount = fc.integer({ min: 0, max: 1_000_000 });

const arbSplit: fc.Arbitrary<Split> = ids.chain((ps) =>
  fc.oneof(
    fc.constant<Split>({ kind: "equal", participantIds: ps }),
    fc
      .array(fc.integer({ min: 0, max: 10 }), { minLength: ps.length, maxLength: ps.length })
      .filter((s) => s.some((n) => n > 0))
      .map<Split>((shares) => ({
        kind: "shares",
        shares: ps.map((participantId, i) => ({ participantId, shares: shares[i] ?? 0 })),
      })),
    fc
      .array(fc.integer({ min: 1, max: 1000 }), { minLength: ps.length, maxLength: ps.length })
      .map<Split>((raw) => {
        const sum = raw.reduce((a, b) => a + b, 0);
        // Scale to percentages that sum to exactly 100 (last one absorbs rounding).
        const percents = raw.map((r) => Math.round((r / sum) * 100 * 1e4) / 1e4);
        const drift = 100 - percents.reduce((a, b) => a + b, 0);
        percents[percents.length - 1] = (percents[percents.length - 1] ?? 0) + drift;
        return {
          kind: "percent",
          percents: ps.map((participantId, i) => ({ participantId, percent: percents[i] ?? 0 })),
        };
      })
      .filter((s) => s.kind === "percent" && s.percents.every((p) => p.percent >= 0)),
  ),
);

describe("splitAmount properties", () => {
  it("covers every participant and sums to the amount", () => {
    fc.assert(
      fc.property(amount, arbSplit, (a, split) => {
        const result = splitAmount(cents(a), split);
        const expectedIds = splitParticipants(split);
        expect(Object.keys(result)).toEqual(expectedIds);
        expect(Object.values(result).reduce((x, y) => x + y, 0)).toBe(a);
      }),
    );
  });
});
