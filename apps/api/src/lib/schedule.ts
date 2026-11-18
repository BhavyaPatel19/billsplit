import type { RecurrenceFrequency } from "@billsplit/contracts";

/** Calendar dates as "YYYY-MM-DD", computed in UTC so no daylight-saving shift moves them. */
export type IsoDate = string;

export interface Cadence {
  frequency: RecurrenceFrequency;
  interval: number;
  startOn: IsoDate;
}

const DAY_MS = 86_400_000;

function parse(date: IsoDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m: m - 1, d };
}

const format = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

export const todayUtc = (now = new Date()): IsoDate => now.toISOString().slice(0, 10);

export function addDays(date: IsoDate, days: number): IsoDate {
  const { y, m, d } = parse(date);
  return format(Date.UTC(y, m, d) + days * DAY_MS);
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * Date of occurrence `n` (0 is the start). Monthly dates keep the start's day of the month and
 * fall back to the month's last day when it is shorter, so the 31st gives Feb 28 then Mar 31.
 */
export function occurrenceDate(c: Cadence, n: number): IsoDate {
  const { y, m, d } = parse(c.startOn);
  if (c.frequency === "weekly") return format(Date.UTC(y, m, d) + n * 7 * c.interval * DAY_MS);
  const months = m + n * c.interval;
  const year = y + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  return format(Date.UTC(year, month, Math.min(d, daysInMonth(year, month))));
}

/** Smallest occurrence index whose date is on or after `date`. */
export function firstOccurrenceOnOrAfter(c: Cadence, date: IsoDate): number {
  if (date <= c.startOn) return 0;
  const { y: sy, m: sm, d: sd } = parse(c.startOn);
  const { y, m, d } = parse(date);
  // Estimate from the elapsed time, then step: the estimate is never more than one off.
  let n =
    c.frequency === "weekly"
      ? Math.floor((Date.UTC(y, m, d) - Date.UTC(sy, sm, sd)) / (7 * c.interval * DAY_MS))
      : Math.floor(((y - sy) * 12 + (m - sm)) / c.interval);
  n = Math.max(0, n - 1);
  while (occurrenceDate(c, n) < date) n += 1;
  return n;
}
