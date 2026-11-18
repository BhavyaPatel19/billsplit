import { describe, expect, it } from "vitest";
import { pantryExpenseInput } from "../src/lib/pantry.js";

const run = {
  description: "Costco run",
  payerId: "ana",
  boughtOn: "2026-11-18",
  taxCents: 0,
  feeCents: 0,
  discountCents: 0,
};

describe("pantryExpenseInput", () => {
  it("splits each item by the units people marked", () => {
    const input = pantryExpenseInput(
      run,
      [
        {
          name: "Milk ×6",
          amountCents: 1200,
          uses: [
            { participantId: "ana", units: 2 },
            { participantId: "bo", units: 4 },
          ],
        },
      ],
      ["ana", "bo", "cy"],
    );
    expect(input.items[0]!.split).toEqual({
      kind: "shares",
      shares: [
        { participantId: "ana", shares: 2 },
        { participantId: "bo", shares: 4 },
      ],
    });
    expect(input).toMatchObject({ payerId: "ana", spentOn: "2026-11-18", adjustments: [] });
  });

  it("shares unmarked items among everyone who used anything, else the whole group", () => {
    const used = pantryExpenseInput(
      run,
      [
        { name: "Eggs", amountCents: 800, uses: [{ participantId: "bo", units: 1 }] },
        { name: "Rice", amountCents: 1500, uses: [{ participantId: "cy", units: 1 }] },
        { name: "Foil", amountCents: 600, uses: [] },
      ],
      ["ana", "bo", "cy"],
    );
    expect(used.items[2]!.split).toEqual({ kind: "equal", participantIds: ["bo", "cy"] });

    const nobody = pantryExpenseInput(
      run,
      [{ name: "Foil", amountCents: 600, uses: [] }],
      ["ana", "bo", "cy"],
    );
    expect(nobody.items[0]!.split).toEqual({ kind: "equal", participantIds: ["ana", "bo", "cy"] });
  });

  it("adds up a merged placeholder's units into the account and resolves the payer", () => {
    const input = pantryExpenseInput(
      { ...run, payerId: "temp" },
      [
        {
          name: "Coffee",
          amountCents: 2000,
          uses: [
            { participantId: "temp", units: 1 },
            { participantId: "bo", units: 2 },
          ],
        },
      ],
      ["ana", "bo"],
      (id) => (id === "temp" ? "bo" : id),
    );
    expect(input.payerId).toBe("bo");
    expect(input.items[0]!.split).toEqual({
      kind: "shares",
      shares: [{ participantId: "bo", shares: 3 }],
    });
  });

  it("passes tax, fees and discounts through as proportional adjustments", () => {
    const input = pantryExpenseInput(
      { ...run, taxCents: 120, feeCents: 0, discountCents: 300 },
      [{ name: "Milk", amountCents: 1200, uses: [] }],
      ["ana"],
    );
    expect(input.adjustments).toEqual([
      { kind: "tax", amountCents: 120, allocation: "proportional" },
      { kind: "discount", amountCents: 300, allocation: "proportional" },
    ]);
  });
});
