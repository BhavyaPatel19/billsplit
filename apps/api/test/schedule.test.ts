import { describe, expect, it } from "vitest";
import {
  addDays,
  firstOccurrenceOnOrAfter,
  occurrenceDate,
  type Cadence,
} from "../src/lib/schedule.js";

const monthly = (startOn: string, interval = 1): Cadence => ({
  frequency: "monthly",
  interval,
  startOn,
});
const weekly = (startOn: string, interval = 1): Cadence => ({
  frequency: "weekly",
  interval,
  startOn,
});
const series = (c: Cadence, n: number) => Array.from({ length: n }, (_, i) => occurrenceDate(c, i));

describe("occurrenceDate", () => {
  it("keeps the day of the month and clamps to shorter months without drifting", () => {
    expect(series(monthly("2027-01-31"), 4)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("uses Feb 29 in a leap year", () => {
    expect(occurrenceDate(monthly("2028-01-30"), 1)).toBe("2028-02-29");
  });

  it("crosses year ends and honours the interval", () => {
    expect(series(monthly("2026-11-15", 2), 3)).toEqual(["2026-11-15", "2027-01-15", "2027-03-15"]);
    expect(series(monthly("2026-12-01", 12), 2)).toEqual(["2026-12-01", "2027-12-01"]);
  });

  it("steps weekly and fortnightly in whole days, across a DST change", () => {
    expect(series(weekly("2027-03-10"), 2)).toEqual(["2027-03-10", "2027-03-17"]);
    expect(series(weekly("2026-10-28", 2), 3)).toEqual(["2026-10-28", "2026-11-11", "2026-11-25"]);
  });
});

describe("firstOccurrenceOnOrAfter", () => {
  it("is 0 on or before the start", () => {
    expect(firstOccurrenceOnOrAfter(monthly("2027-01-31"), "2026-05-01")).toBe(0);
    expect(firstOccurrenceOnOrAfter(monthly("2027-01-31"), "2027-01-31")).toBe(0);
  });

  it("matches a brute-force search for many cadences and dates", () => {
    const cadences = [
      monthly("2027-01-31"),
      monthly("2027-01-29", 3),
      monthly("2026-12-15", 12),
      weekly("2027-02-26"),
      weekly("2027-02-26", 3),
    ];
    for (const c of cadences) {
      for (let day = 0; day < 800; day += 3) {
        const date = addDays(c.startOn, day);
        let n = 0;
        while (occurrenceDate(c, n) < date) n += 1;
        expect(firstOccurrenceOnOrAfter(c, date), `${JSON.stringify(c)} ${date}`).toBe(n);
      }
    }
  });
});
