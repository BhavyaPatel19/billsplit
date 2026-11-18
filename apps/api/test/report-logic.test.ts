import { describe, expect, it } from "vitest";
import type { ExpenseSummary } from "@billsplit/contracts";
import { buildReport, csvCell, reportCsv } from "../src/lib/report.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const E1 = "33333333-3333-4333-8333-333333333333";
const E2 = "44444444-4444-4444-8444-444444444444";
const P1 = "55555555-5555-4555-8555-555555555555";

const expense = (
  id: string,
  spentOn: string,
  description: string,
  total: number,
  owed: [number, number],
): ExpenseSummary => ({
  id,
  version: 1,
  description,
  currency: "USD",
  spentOn,
  payerId: A,
  totalCents: total,
  shares: [
    { participantId: A, paidCents: total, owedCents: owed[0] },
    { participantId: B, paidCents: 0, owedCents: owed[1] },
  ],
  recurringId: null,
  createdAt: `${spentOn}T12:00:00.000Z`,
  updatedAt: `${spentOn}T12:00:00.000Z`,
});

const report = () =>
  buildReport({
    groupName: "Flat 4B",
    currency: "USD",
    from: "2026-11-01",
    to: "2026-11-30",
    people: [
      { id: A, name: "Ana" },
      { id: B, name: "Bo" },
    ],
    expenses: [
      expense(E2, "2026-11-20", '=HYPERLINK("x")', 3000, [1500, 1500]),
      expense(E1, "2026-11-01", "Rent, November", 200_000, [100_000, 100_000]),
    ],
    payments: [{ id: P1, on: "2026-11-25", fromId: B, toId: A, amountCents: 50_000, note: null }],
    balances: {
      currency: "USD",
      balances: [
        { participantId: A, netCents: 51_500 },
        { participantId: B, netCents: -51_500 },
      ],
      transfers: [{ fromId: B, toId: A, amountCents: 51_500 }],
    },
    now: new Date("2026-12-01T00:00:00Z"),
  });

describe("buildReport", () => {
  it("totals each person for the period and keeps today's balances", () => {
    const r = report();
    expect(r.people).toEqual([
      {
        participantId: A,
        name: "Ana",
        paidCents: 203_000,
        owedCents: 101_500,
        sentCents: 0,
        receivedCents: 50_000,
        periodNetCents: 51_500,
        balanceCents: 51_500,
      },
      {
        participantId: B,
        name: "Bo",
        paidCents: 0,
        owedCents: 101_500,
        sentCents: 50_000,
        receivedCents: 0,
        periodNetCents: -51_500,
        balanceCents: -51_500,
      },
    ]);
    expect(r.expenses.map((e) => e.spentOn)).toEqual(["2026-11-01", "2026-11-20"]);
    expect(r.totals).toEqual({ expensesCents: 203_000, paymentsCents: 50_000 });
  });
});

describe("reportCsv", () => {
  it("writes sections with a share column per person", () => {
    const lines = reportCsv(report()).split("\r\n");
    expect(lines).toContain("Date,Description,Paid by,Total,Ana share,Bo share");
    expect(lines).toContain('2026-11-01,"Rent, November",Ana,2000.00,1000.00,1000.00');
    expect(lines).toContain("2026-11-25,Bo,Ana,500.00,");
    expect(lines).toContain("Bo,Ana,515.00");
    expect(lines).toContain("Bo,0.00,1015.00,500.00,0.00,-515.00,-515.00");
  });

  it("defuses spreadsheet formulas and quotes what needs it", () => {
    expect(reportCsv(report())).toContain(`2026-11-20,"'=HYPERLINK(""x"")",Ana,30.00`);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell(-515)).toBe("-515");
    expect(csvCell("-515.00")).toBe("-515.00");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
});
