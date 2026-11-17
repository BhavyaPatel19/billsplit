import { describe, expect, it } from "vitest";
import type { Activity } from "@billsplit/contracts";
import { describeActivity, timeAgo } from "./activity-text";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const names: Record<string, string> = { [A]: "You", [B]: "Bo" };
const name = (id: string) => names[id] ?? "Former member";
const base = { id: A, subjectId: null, involvesMe: true, createdAt: "2026-11-17T10:00:00Z" };

describe("describeActivity", () => {
  it("reads each kind as a sentence", () => {
    const cases: [Activity, string][] = [
      [
        {
          ...base,
          actorId: B,
          kind: "expense.added",
          data: { description: "Dinner", totalCents: 3000, currency: "USD", payerId: B },
        },
        "Bo added Dinner ($30.00)",
      ],
      [
        {
          ...base,
          actorId: A,
          kind: "payment.recorded",
          data: { fromId: B, toId: A, amountCents: 1250, currency: "USD" },
        },
        "You recorded Bo paying You $12.50",
      ],
      [
        { ...base, actorId: null, kind: "member.joined", data: { displayName: "Cy" } },
        "Cy joined the group",
      ],
      [
        {
          ...base,
          actorId: A,
          kind: "member.merged",
          data: { placeholderName: "Rahul", intoId: B },
        },
        "You merged Rahul into Bo",
      ],
      [
        {
          ...base,
          actorId: null,
          kind: "expense.deleted",
          data: { description: "Taxi", totalCents: 900, currency: "USD", payerId: A },
        },
        "Someone deleted Taxi ($9.00)",
      ],
    ];
    for (const [activity, text] of cases) expect(describeActivity(activity, name)).toBe(text);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  it("rounds to the largest sensible unit", () => {
    expect(timeAgo("2026-11-17T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-17T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-11-17T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-11-15T12:00:00Z", now)).toBe("2 d ago");
    expect(timeAgo("2026-10-01T12:00:00Z", now)).toBe("2026-10-01");
  });
});
