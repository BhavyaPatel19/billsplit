import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AcceptInviteResponseSchema,
  BalancesResponseSchema,
  ExpenseDetailSchema,
  ExpenseListResponseSchema,
  GroupDetailSchema,
  InviteSchema,
  ParticipantSchema,
  SettlementListResponseSchema,
  SettlementSchema,
  type BalancesResponse,
  type ExpenseInput,
} from "@billsplit/contracts";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = "";
let bo = "";
let outsider = "";
let groupId = "";
let A = ""; // participant ids
let B = "";
let R = ""; // Rahul, a placeholder

const api = (
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
) => request(ctx.app, path, init);

async function balances(cookie = ana): Promise<BalancesResponse> {
  const res = await api(`/api/groups/${groupId}/balances`, { cookie });
  expect(res.status).toBe(200);
  return BalancesResponseSchema.parse(await res.json());
}
const net = (b: BalancesResponse) =>
  Object.fromEntries(b.balances.map((x) => [x.participantId, x.netCents]));

beforeAll(async () => {
  ctx = await startTestContext();
  [ana, bo, outsider] = await Promise.all([
    signUpVerified(ctx, "Ana", "ana@example.com"),
    signUpVerified(ctx, "Bo", "bo@example.com"),
    signUpVerified(ctx, "Out", "out@example.com"),
  ]);
  const group = GroupDetailSchema.parse(
    await (await api("/api/groups", { cookie: ana, body: { name: "Dinner club" } })).json(),
  );
  groupId = group.id;
  A = group.myParticipantId;
  R = ParticipantSchema.parse(
    await (
      await api(`/api/groups/${groupId}/participants`, {
        cookie: ana,
        body: { displayName: "Rahul" },
      })
    ).json(),
  ).id;
  const invite = InviteSchema.parse(
    await (await api(`/api/groups/${groupId}/invites`, { cookie: ana, body: {} })).json(),
  );
  B = AcceptInviteResponseSchema.parse(
    await (await api(`/api/invites/${invite.code}/accept`, { cookie: bo, body: {} })).json(),
  ).participantId;
});

afterAll(async () => {
  await ctx?.stop();
});

/** The worked example from docs/adr/0001-money-as-integer-cents.md. */
const dinner = (): ExpenseInput => ({
  description: "Dinner at Luigi's",
  spentOn: "2026-11-08",
  payerId: A,
  items: [
    {
      name: "Burger",
      amountCents: 1500,
      quantity: 1,
      split: { kind: "equal", participantIds: [A] },
    },
    {
      name: "Pizza",
      amountCents: 2400,
      quantity: 1,
      split: {
        kind: "percent",
        percents: [
          { participantId: A, percent: 90 },
          { participantId: B, percent: 10 }, // one bite
        ],
      },
    },
    {
      name: "Salad",
      amountCents: 300,
      quantity: 3,
      split: { kind: "equal", participantIds: [A, B, R] },
    },
  ],
  adjustments: [
    { kind: "tax", amountCents: 396, allocation: "proportional" },
    { kind: "tip", amountCents: 864, allocation: "proportional" },
    { kind: "discount", amountCents: 500, allocation: "equal" },
  ],
});

let expenseId = "";

describe("expenses", () => {
  it("starts with everyone settled", async () => {
    const b = await balances();
    expect(b.currency).toBe("USD");
    expect(net(b)).toEqual({ [A]: 0, [B]: 0, [R]: 0 });
    expect(b.transfers).toEqual([]);
  });

  it("computes an itemised receipt with a 10% bite and proportional tax and tip", async () => {
    const res = await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: dinner() });
    expect(res.status).toBe(201);
    const e = ExpenseDetailSchema.parse(await res.json());
    expenseId = e.id;
    expect(e).toMatchObject({
      version: 1,
      totalCents: 5560,
      payerId: A,
      currency: "USD",
      spentOn: "2026-11-08",
    });
    expect(Object.fromEntries(e.shares.map((s) => [s.participantId, s.owedCents]))).toEqual({
      [A]: 4833,
      [B]: 514,
      [R]: 213,
    });
    expect(e.shares.find((s) => s.participantId === A)!.paidCents).toBe(5560);
    expect(e.items[1]!.perParticipant).toEqual({ [A]: 2160, [B]: 240 });
    expect(e.items[2]!.totalCents).toBe(900);
    expect(e.adjustments[0]!.perParticipant).toEqual({ [A]: 327, [B]: 44, [R]: 25 });
  });

  it("turns it into balances and the fewest payments", async () => {
    const b = await balances(bo);
    expect(net(b)).toEqual({ [A]: 727, [B]: -514, [R]: -213 });
    expect(b.transfers).toEqual([
      { fromId: B, toId: A, amountCents: 514 },
      { fromId: R, toId: A, amountCents: 213 },
    ]);
  });

  it("lists expenses for members", async () => {
    const list = ExpenseListResponseSchema.parse(
      await (await api(`/api/groups/${groupId}/expenses`, { cookie: bo })).json(),
    );
    expect(list.expenses.map((e) => e.description)).toEqual(["Dinner at Luigi's"]);
  });

  it("records a payment and updates balances", async () => {
    const res = await api(`/api/groups/${groupId}/settlements`, {
      cookie: bo,
      body: { fromId: B, toId: A, amountCents: 514, note: "Venmo" },
    });
    expect(res.status).toBe(201);
    expect(SettlementSchema.parse(await res.json())).toMatchObject({
      fromId: B,
      toId: A,
      amountCents: 514,
      note: "Venmo",
    });
    const b = await balances();
    expect(net(b)).toEqual({ [A]: 213, [B]: 0, [R]: -213 });
    expect(b.transfers).toEqual([{ fromId: R, toId: A, amountCents: 213 }]);
  });

  it("edits by creating a new version", async () => {
    const res = await api(`/api/groups/${groupId}/expenses/${expenseId}`, {
      cookie: bo,
      method: "PUT",
      body: {
        description: "Dinner (corrected)",
        payerId: A,
        items: [
          {
            name: "Everything",
            amountCents: 3000,
            split: { kind: "equal", participantIds: [A, B, R] },
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    const e = ExpenseDetailSchema.parse(await res.json());
    expect(e).toMatchObject({
      id: expenseId,
      version: 2,
      totalCents: 3000,
      description: "Dinner (corrected)",
    });
    // 1000 each; Bo already paid 514.
    expect(net(await balances())).toEqual({ [A]: 1486, [B]: -486, [R]: -1000 });
  });

  it("refuses to delete a placeholder with history and merges instead", async () => {
    expect(
      (await api(`/api/groups/${groupId}/participants/${R}`, { cookie: ana, method: "DELETE" }))
        .status,
    ).toBe(409);
    const merged = await api(`/api/groups/${groupId}/participants/${R}/merge`, {
      cookie: ana,
      body: { intoParticipantId: B },
    });
    expect(merged.status).toBe(200);
    const b = await balances();
    expect(net(b)).toEqual({ [A]: 1486, [B]: -1486 });
    expect(b.transfers).toEqual([{ fromId: B, toId: A, amountCents: 1486 }]);
    // Old records now point at Bo.
    const e = ExpenseDetailSchema.parse(
      await (await api(`/api/groups/${groupId}/expenses/${expenseId}`, { cookie: ana })).json(),
    );
    expect(e.shares.find((s) => s.participantId === B)!.owedCents).toBe(2000);
    expect(e.items[0]!.split).toEqual({ kind: "equal", participantIds: [A, B] });
  });

  it("deletes an expense", async () => {
    expect(
      (await api(`/api/groups/${groupId}/expenses/${expenseId}`, { cookie: bo, method: "DELETE" }))
        .status,
    ).toBe(204);
    expect((await api(`/api/groups/${groupId}/expenses/${expenseId}`, { cookie: bo })).status).toBe(
      404,
    );
    expect(net(await balances())).toEqual({ [A]: -514, [B]: 514 });
  });

  it("undoes a payment (only whoever recorded it, or the owner)", async () => {
    const { settlements } = SettlementListResponseSchema.parse(
      await (await api(`/api/groups/${groupId}/settlements`, { cookie: ana })).json(),
    );
    expect(settlements).toHaveLength(1);
    expect(
      (
        await api(`/api/groups/${groupId}/settlements/${settlements[0]!.id}`, {
          cookie: ana,
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    expect(net(await balances())).toEqual({ [A]: 0, [B]: 0 });
  });
});

describe("validation", () => {
  const expectCode = async (body: unknown, code: string) => {
    const res = await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ details: { code } });
  };

  it("rejects percentages that do not add up to 100", () =>
    expectCode(
      {
        description: "x",
        payerId: A,
        items: [
          {
            name: "x",
            amountCents: 100,
            split: {
              kind: "percent",
              percents: [
                { participantId: A, percent: 50 },
                { participantId: B, percent: 49 },
              ],
            },
          },
        ],
      },
      "PERCENT_SUM_MISMATCH",
    ));

  it("rejects exact amounts that do not add up", () =>
    expectCode(
      {
        description: "x",
        payerId: A,
        items: [
          {
            name: "x",
            amountCents: 100,
            split: { kind: "exact", amounts: [{ participantId: A, amount: 99 }] },
          },
        ],
      },
      "EXACT_SUM_MISMATCH",
    ));

  it("rejects people outside the group", async () => {
    const res = await api(`/api/groups/${groupId}/expenses`, {
      cookie: ana,
      body: {
        description: "x",
        payerId: A,
        items: [{ name: "x", amountCents: 100, split: { kind: "equal", participantIds: [A, R] } }], // R was merged
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Everyone in the split must be in the group" });
  });

  it("rejects malformed bodies with field details", async () => {
    const res = await api(`/api/groups/${groupId}/expenses`, {
      cookie: ana,
      body: {
        description: "",
        payerId: A,
        items: [{ name: "x", amountCents: 1.5, split: { kind: "equal", participantIds: [A] } }],
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: Array<{ path: Array<string | number> }> };
    expect(body.details.map((d) => d.path.join("."))).toEqual(
      expect.arrayContaining(["description", "items.0.amountCents"]),
    );
  });

  it("rejects bad payments", async () => {
    expect(
      (
        await api(`/api/groups/${groupId}/settlements`, {
          cookie: ana,
          body: { fromId: A, toId: A, amountCents: 5 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(`/api/groups/${groupId}/settlements`, {
          cookie: ana,
          body: { fromId: A, toId: R, amountCents: 5 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(`/api/groups/${groupId}/settlements`, {
          cookie: ana,
          body: { fromId: A, toId: B, amountCents: 0 },
        })
      ).status,
    ).toBe(400);
  });
});

describe("idempotency", () => {
  it("returns the original expense for a retried request", async () => {
    const headers = { "idempotency-key": "retry-test-1" };
    const body = {
      ...dinner(),
      items: [
        {
          name: "Taxi",
          amountCents: 2000,
          quantity: 1,
          split: { kind: "equal", participantIds: [A, B] },
        },
      ],
      adjustments: [],
    };
    const first = await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body, headers });
    const second = await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body, headers });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(ExpenseDetailSchema.parse(await second.json()).id).toBe(
      ExpenseDetailSchema.parse(await first.json()).id,
    );
    const list = ExpenseListResponseSchema.parse(
      await (await api(`/api/groups/${groupId}/expenses`, { cookie: ana })).json(),
    );
    expect(list.expenses.filter((e) => e.description === body.description)).toHaveLength(1);
  });

  it("does the same for payments, even when sent concurrently", async () => {
    const headers = { "idempotency-key": "pay-race-1" };
    const body = { fromId: B, toId: A, amountCents: 1000 };
    const [r1, r2] = await Promise.all([
      api(`/api/groups/${groupId}/settlements`, { cookie: bo, body, headers }),
      api(`/api/groups/${groupId}/settlements`, { cookie: bo, body, headers }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    const { settlements } = SettlementListResponseSchema.parse(
      await (await api(`/api/groups/${groupId}/settlements`, { cookie: ana })).json(),
    );
    expect(settlements.filter((s) => s.amountCents === 1000)).toHaveLength(1);
  });
});

describe("access control", () => {
  it("hides every money endpoint from non-members", async () => {
    for (const [path, init] of [
      [`/api/groups/${groupId}/expenses`, {}],
      [`/api/groups/${groupId}/expenses`, { body: dinner() }],
      [`/api/groups/${groupId}/expenses/${expenseId}`, {}],
      [`/api/groups/${groupId}/balances`, {}],
      [`/api/groups/${groupId}/settlements`, {}],
      [`/api/groups/${groupId}/settlements`, { body: { fromId: A, toId: B, amountCents: 1 } }],
    ] as const) {
      expect((await api(path, { cookie: outsider, ...init })).status).toBe(404);
    }
  });

  it("requires a session", async () => {
    expect((await api(`/api/groups/${groupId}/balances`)).status).toBe(401);
  });
});
