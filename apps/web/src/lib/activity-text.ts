import type { Activity } from "@billsplit/contracts";
import { money } from "./money";

/** One-line description of a feed entry, e.g. "Bo added Dinner ($30.00)". */
export function describeActivity(a: Activity, name: (participantId: string) => string): string {
  const who = a.actorId ? name(a.actorId) : "Someone";
  switch (a.kind) {
    case "expense.added":
      if (a.data.recurringId)
        return `${a.data.description} was posted (${money(a.data.totalCents, a.data.currency)}, repeats)`;
      return `${who} added ${a.data.description} (${money(a.data.totalCents, a.data.currency)})`;
    case "expense.edited":
      return `${who} edited ${a.data.description} (now ${money(a.data.totalCents, a.data.currency)})`;
    case "expense.deleted":
      return `${who} deleted ${a.data.description} (${money(a.data.totalCents, a.data.currency)})`;
    case "payment.recorded":
      return `${who} recorded ${name(a.data.fromId)} paying ${name(a.data.toId)} ${money(a.data.amountCents, a.data.currency)}`;
    case "payment.removed":
      return `${who} removed a payment of ${money(a.data.amountCents, a.data.currency)} from ${name(a.data.fromId)} to ${name(a.data.toId)}`;
    case "member.joined":
      return `${a.data.displayName} joined the group`;
    case "member.merged":
      return `${who} merged ${a.data.placeholderName} into ${name(a.data.intoId)}`;
  }
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} d ago`;
  return iso.slice(0, 10);
}
