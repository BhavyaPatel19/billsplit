import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GroupDetailSchema,
  InviteSchema,
  ReportSchema,
  type ExpenseInput,
} from "@billsplit/contracts";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = "";
let bo = "";
let groupId = "";
let A = "";
let B = "";

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);

const expense = (description: string, spentOn: string, amountCents: number): ExpenseInput => ({
  description,
  spentOn,
  payerId: A,
  items: [
    {
      name: description,
      amountCents,
      quantity: 1,
      split: { kind: "equal", participantIds: [A, B] },
    },
  ],
  adjustments: [],
});

beforeAll(async () => {
  ctx = await startTestContext();
  [ana, bo] = await Promise.all([
    signUpVerified(ctx, "Ana", "ana@example.com"),
    signUpVerified(ctx, "Bo", "bo@example.com"),
  ]);
  const group = GroupDetailSchema.parse(
    await (await api("/api/groups", { cookie: ana, body: { name: "Flat 4B" } })).json(),
  );
  groupId = group.id;
  A = group.myParticipantId;
  const invite = InviteSchema.parse(
    await (await api(`/api/groups/${groupId}/invites`, { cookie: ana, body: {} })).json(),
  );
  await api(`/api/invites/${invite.code}/accept`, { cookie: bo, body: {} });
  const detail = GroupDetailSchema.parse(
    await (await api(`/api/groups/${groupId}`, { cookie: ana })).json(),
  );
  B = detail.participants.find((p) => p.displayName === "Bo")!.id;

  for (const e of [
    expense("Rent, October", "2026-10-01", 200_000),
    expense("Rent, November", "2026-11-01", 200_000),
    expense("=cmd()", "2026-11-12", 3_000),
  ]) {
    await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: e });
  }
  await api(`/api/groups/${groupId}/settlements`, {
    cookie: bo,
    body: { fromId: B, toId: A, amountCents: 50_000, note: "Venmo" },
  });
});

afterAll(async () => {
  await ctx?.stop();
});

describe("move-out report", () => {
  it("covers the whole history by default", async () => {
    const r = ReportSchema.parse(
      await (await api(`/api/groups/${groupId}/report`, { cookie: bo })).json(),
    );
    expect(r.expenses.map((e) => e.description)).toEqual([
      "Rent, October",
      "Rent, November",
      "=cmd()",
    ]);
    expect(r.totals).toEqual({ expensesCents: 403_000, paymentsCents: 50_000 });
    // Bo owes 201,500 for everything and has paid 50,000 back.
    expect(r.people.find((p) => p.participantId === B)).toMatchObject({
      owedCents: 201_500,
      sentCents: 50_000,
      balanceCents: -151_500,
    });
    expect(r.settleUp).toEqual([{ fromId: B, toId: A, amountCents: 151_500 }]);
  });

  it("limits the listing and period totals to the dates asked for, but not the balances", async () => {
    const r = ReportSchema.parse(
      await (
        await api(`/api/groups/${groupId}/report?from=2026-11-01&to=2026-11-30`, { cookie: ana })
      ).json(),
    );
    expect(r.expenses.map((e) => e.spentOn)).toEqual(["2026-11-01", "2026-11-12"]);
    const bo = r.people.find((p) => p.participantId === B)!;
    expect(bo.owedCents).toBe(101_500);
    expect(bo.balanceCents).toBe(-151_500);
  });

  it("downloads as a CSV with formulas defused", async () => {
    const res = await api(`/api/groups/${groupId}/report.csv?from=2026-11-01`, { cookie: ana });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="flat-4b-report-2026-11-01-to-today.csv"',
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    // UTF-8 byte-order mark first, so Excel reads names correctly.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("Flat 4B move-out report")).toBe(true);
    expect(text).toContain("2026-11-12,'=cmd(),Ana,30.00,15.00,15.00");
    expect(text).not.toContain("Rent, October");
  });

  it("rejects backwards periods and hides the report from outsiders", async () => {
    expect(
      (await api(`/api/groups/${groupId}/report?from=2026-12-01&to=2026-11-01`, { cookie: ana }))
        .status,
    ).toBe(400);
    const outsider = await signUpVerified(ctx, "Ola", "ola@example.com");
    expect((await api(`/api/groups/${groupId}/report`, { cookie: outsider })).status).toBe(404);
    expect((await api(`/api/groups/${groupId}/report.csv`, { cookie: outsider })).status).toBe(404);
    expect((await api(`/api/groups/${groupId}/report`)).status).toBe(401);
  });
});
