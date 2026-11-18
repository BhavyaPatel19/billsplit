import { describe, expect, it } from "vitest";
import type { ExpenseInput } from "@billsplit/contracts";
import { describeCadence, formatDate, parseRepeat, toRecurringBody } from "./recurring";

const A = "11111111-1111-4111-8111-111111111111";
const input: ExpenseInput = {
  description: "Rent",
  spentOn: "2026-12-01",
  payerId: A,
  items: [
    {
      name: "Rent",
      amountCents: 200_000,
      quantity: 1,
      split: { kind: "equal", participantIds: [A] },
    },
  ],
  adjustments: [],
};

describe("toRecurringBody", () => {
  it("is null for a one-off", () => {
    expect(toRecurringBody(input, "none", "")).toBeNull();
  });

  it("starts on the expense date and drops spentOn from the template", () => {
    expect(toRecurringBody(input, "monthly-1", "")).toEqual({
      expense: {
        description: "Rent",
        payerId: A,
        items: input.items,
        adjustments: [],
      },
      frequency: "monthly",
      interval: 1,
      startOn: "2026-12-01",
    });
  });

  it("passes an end date through", () => {
    expect(toRecurringBody(input, "weekly-2", "2027-06-30")).toMatchObject({
      frequency: "weekly",
      interval: 2,
      endOn: "2027-06-30",
    });
  });
});

describe("parseRepeat", () => {
  it("reads every option", () => {
    expect(parseRepeat("monthly-3")).toEqual({ frequency: "monthly", interval: 3 });
    expect(parseRepeat("weekly-1")).toEqual({ frequency: "weekly", interval: 1 });
  });
});

describe("describeCadence", () => {
  it("names the day", () => {
    expect(describeCadence({ frequency: "monthly", interval: 1, startOn: "2026-12-01" })).toBe(
      "Every month on the 1st",
    );
    expect(describeCadence({ frequency: "monthly", interval: 3, startOn: "2026-12-22" })).toBe(
      "Every 3 months on the 22nd",
    );
    expect(describeCadence({ frequency: "monthly", interval: 1, startOn: "2026-12-13" })).toBe(
      "Every month on the 13th",
    );
    expect(describeCadence({ frequency: "monthly", interval: 1, startOn: "2027-01-31" })).toBe(
      "Every month on the 31st (or the last day)",
    );
    // 2026-11-20 is a Friday.
    expect(describeCadence({ frequency: "weekly", interval: 2, startOn: "2026-11-20" })).toBe(
      "Every 2 weeks on Friday",
    );
  });

  it("formats dates without shifting them by time zone", () => {
    expect(formatDate("2026-12-01")).toBe("Tue, Dec 1, 2026");
  });
});
