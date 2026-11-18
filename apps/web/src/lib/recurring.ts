import type {
  CreateRecurringBody,
  ExpenseInput,
  RecurrenceFrequency,
  RecurringExpense,
} from "@billsplit/contracts";

/** The choices the expense form offers; "none" saves a one-off expense. */
export const REPEAT_OPTIONS = [
  { value: "none", label: "Doesn't repeat" },
  { value: "weekly-1", label: "Every week" },
  { value: "weekly-2", label: "Every 2 weeks" },
  { value: "monthly-1", label: "Every month" },
  { value: "monthly-3", label: "Every 3 months" },
] as const;
export type RepeatChoice = (typeof REPEAT_OPTIONS)[number]["value"];

export function parseRepeat(
  choice: RepeatChoice,
): { frequency: RecurrenceFrequency; interval: number } | null {
  if (choice === "none") return null;
  const [frequency, interval] = choice.split("-") as [RecurrenceFrequency, string];
  return { frequency, interval: Number(interval) };
}

/** Turn a validated expense into a schedule that starts on the expense's date. */
export function toRecurringBody(
  input: ExpenseInput,
  choice: RepeatChoice,
  endOn: string,
): CreateRecurringBody | null {
  const cadence = parseRepeat(choice);
  if (!cadence) return null;
  const { spentOn, ...expense } = input;
  return {
    expense,
    ...cadence,
    startOn: spentOn ?? new Date().toISOString().slice(0, 10),
    ...(endOn ? { endOn } : {}),
  };
}

const ordinal = (n: number) =>
  n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Every month on the 1st", "Every 2 weeks on Friday". Day 29-31 reads as "or the last day". */
export function describeCadence(
  r: Pick<RecurringExpense, "frequency" | "interval" | "startOn">,
): string {
  const date = new Date(`${r.startOn}T00:00:00Z`);
  if (r.frequency === "weekly") {
    const every = r.interval === 1 ? "Every week" : `Every ${r.interval} weeks`;
    return `${every} on ${WEEKDAYS[date.getUTCDay()]}`;
  }
  const every = r.interval === 1 ? "Every month" : `Every ${r.interval} months`;
  const day = date.getUTCDate();
  return `${every} on the ${ordinal(day)}${day > 28 ? " (or the last day)" : ""}`;
}

/** Long, friendly date: "Mon, Dec 1, 2026". */
export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
