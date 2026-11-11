import { cents, formatCents } from "@billsplit/split-engine";

/** "$12.34" for 1234 USD. */
export function money(amountCents: number, currency: string): string {
  return formatCents(cents(amountCents), currency);
}
