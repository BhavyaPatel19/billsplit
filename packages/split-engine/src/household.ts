import { allocate } from "./allocate.js";
import { SplitError } from "./errors.js";
import { cents, type Cents } from "./money.js";
import { assertUniqueParticipants, type ParticipantId } from "./split.js";

/** A calendar date, "YYYY-MM-DD". Day arithmetic is done in UTC, so DST never shifts it. */
export type IsoDate = string;

/** Both ends included: Nov 1 to Nov 30 is 30 days. */
export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface Resident {
  participantId: ParticipantId;
  /**
   * How much of the rent their room carries: square feet, or a relative number such as 1.2
   * for the room with the bathroom. Only used for `rent`. Defaults to 1.
   */
  weight?: number;
  /** First day they lived there, if it falls in the period. */
  movedInOn?: IsoDate;
  /** Last day they lived there, if it falls in the period. */
  movedOutOn?: IsoDate;
  /** Trips and other days away. Only used for `usage`. May overlap each other. */
  away?: readonly DateRange[];
}

/**
 * - `rent`: room weight × days living there. Being away on a trip does not reduce rent.
 * - `usage`: days actually present (living there, minus days away), equal per person-day.
 *   For utilities and groceries that scale with who is around.
 */
export type ProrationBasis = "rent" | "usage";

export interface Proration {
  /** Each resident's share; sums exactly to the amount. */
  shares: Record<ParticipantId, Cents>;
  /** Days counted for each resident under the basis. */
  days: Record<ParticipantId, number>;
  /** The weight each share was allocated by (days, or weight × days for rent). */
  weights: Record<ParticipantId, number>;
}

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 for a valid ISO date. */
function dayNumber(date: IsoDate, label: string): number {
  const m = DATE_RE.exec(date);
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
  // Date.UTC rolls Feb 30 over to Mar 2; formatting back catches that.
  if (!m || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new SplitError("INVALID_DATE", `${label} must be a real date (YYYY-MM-DD), got ${date}`);
  }
  return ms / DAY_MS;
}

/** Inclusive day count of a range, after clipping it to [lo, hi]; 0 if they do not overlap. */
const overlap = (from: number, to: number, lo: number, hi: number) =>
  Math.max(0, Math.min(to, hi) - Math.max(from, lo) + 1);

/** Days in [lo, hi] covered by at least one of the ranges (overlapping trips counted once). */
function coveredDays(ranges: readonly [number, number][], lo: number, hi: number): number {
  const clipped = ranges
    .map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)] as const)
    .filter(([a, b]) => a <= b)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let end = Number.NEGATIVE_INFINITY;
  for (const [a, b] of clipped) {
    const start = Math.max(a, end + 1);
    if (b >= start) total += b - start + 1;
    end = Math.max(end, b);
  }
  return total;
}

/**
 * Split a household bill for one period by who lived there and when.
 *
 * Someone who moved in on the 16th of a 30-day month pays 15/30 of what they would for the
 * whole month; with `usage`, a week away also comes off. The shares go through
 * {@link allocate}, so they sum exactly to `amount` and each is within a cent of its exact
 * share.
 *
 * @throws {SplitError} `INVALID_DATE` for a malformed date or a range that ends before it
 *   starts (including moving out before moving in).
 * @throws {SplitError} `EMPTY_PARTICIPANTS` / `DUPLICATE_PARTICIPANT` for the resident list.
 * @throws {SplitError} `INVALID_WEIGHT` for a negative or non-finite room weight.
 * @throws {SplitError} `ZERO_WEIGHTS` when nobody was there (or every weight is zero) but the
 *   amount is not zero.
 *
 * @example
 * ```ts
 * prorate(cents(300000), { from: "2026-11-01", to: "2026-11-30" }, [
 *   { participantId: "ana" },
 *   { participantId: "bo", movedInOn: "2026-11-16" },
 * ], "rent").shares; // { ana: 200000, bo: 100000 }
 * ```
 */
export function prorate(
  amount: Cents,
  period: DateRange,
  residents: readonly Resident[],
  basis: ProrationBasis,
): Proration {
  const total = cents(amount);
  const lo = dayNumber(period.from, "Period start");
  const hi = dayNumber(period.to, "Period end");
  if (hi < lo) throw new SplitError("INVALID_DATE", "The period ends before it starts");
  if (residents.length === 0)
    throw new SplitError("EMPTY_PARTICIPANTS", "A household bill needs at least one resident");
  assertUniqueParticipants(residents.map((r) => r.participantId));

  const days: Record<ParticipantId, number> = {};
  const weights: Record<ParticipantId, number> = {};
  for (const r of residents) {
    const id = r.participantId;
    // An open end reaches past the period, so moving in after it (or out before it) simply
    // counts zero days rather than reading as "out before in".
    const movedIn = r.movedInOn ? dayNumber(r.movedInOn, `Move-in for ${id}`) : undefined;
    const movedOut = r.movedOutOn ? dayNumber(r.movedOutOn, `Move-out for ${id}`) : undefined;
    const from = movedIn ?? Math.min(lo, movedOut ?? lo);
    const to = movedOut ?? Math.max(hi, from);
    if (to < from) throw new SplitError("INVALID_DATE", `${id} moves out before moving in`);
    const resident = overlap(from, to, lo, hi);

    let counted = resident;
    if (basis === "usage") {
      const away = (r.away ?? []).map((range, i): [number, number] => {
        const a = dayNumber(range.from, `Away start ${i} for ${id}`);
        const b = dayNumber(range.to, `Away end ${i} for ${id}`);
        if (b < a) throw new SplitError("INVALID_DATE", `Away period ${i} for ${id} ends first`);
        return [a, b];
      });
      // Only days they lived there can be days away.
      counted = resident - coveredDays(away, Math.max(from, lo), Math.min(to, hi));
    }

    const weight = basis === "rent" ? (r.weight ?? 1) : 1;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new SplitError("INVALID_WEIGHT", `Room weight for ${id} must be non-negative`);
    }
    days[id] = counted;
    weights[id] = weight * counted;
  }

  const allocated = allocate(
    total,
    residents.map((r) => weights[r.participantId]!),
  );
  const shares = Object.fromEntries(
    residents.map((r, i) => [r.participantId, allocated[i]!]),
  ) as Record<ParticipantId, Cents>;
  return { shares, days, weights };
}

/** Inclusive number of days in a range. */
export function daysInRange(range: DateRange): number {
  const lo = dayNumber(range.from, "Start");
  const hi = dayNumber(range.to, "End");
  if (hi < lo) throw new SplitError("INVALID_DATE", "The range ends before it starts");
  return hi - lo + 1;
}
