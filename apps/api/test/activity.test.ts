import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ActivityListResponseSchema,
  ExpenseDetailSchema,
  GroupDetailSchema,
  InviteSchema,
  ParticipantSchema,
  SettlementSchema,
  type Activity,
  type ExpenseInput,
} from "@billsplit/contracts";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = "";
let bo = "";
let cy = "";
let outsider = "";
let groupId = "";
let A = "";
let B = "";
let R = ""; // placeholder

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);

const feed = async (cookie = ana, query = "") => {
  const res = await api(`/api/groups/${groupId}/activity${query}`, { cookie });
  expect(res.status).toBe(200);
  return ActivityListResponseSchema.parse(await res.json());
};

const dinner = (people: string[], description = "Dinner"): ExpenseInput => ({
  description,
  payerId: A,
  items: [
    {
      name: "Food",
      amountCents: 3000,
      quantity: 1,
      split: { kind: "equal", participantIds: people },
    },
  ],
  adjustments: [],
});

beforeAll(async () => {
  ctx = await startTestContext();
  [ana, bo, cy, outsider] = await Promise.all([
    signUpVerified(ctx, "Ana", "ana@example.com"),
    signUpVerified(ctx, "Bo", "bo@example.com"),
    signUpVerified(ctx, "Cy", "cy@example.com"),
    signUpVerified(ctx, "Out", "out@example.com"),
  ]);
  const group = GroupDetailSchema.parse(
    await (await api("/api/groups", { cookie: ana, body: { name: "Flat" } })).json(),
  );
  groupId = group.id;
  A = group.myParticipantId;
  const invite = InviteSchema.parse(
    await (await api(`/api/groups/${groupId}/invites`, { cookie: ana, body: {} })).json(),
  );
  await api(`/api/invites/${invite.code}/accept`, { cookie: bo, body: {} });
  await api(`/api/invites/${invite.code}/accept`, { cookie: cy, body: {} });
  const detail = GroupDetailSchema.parse(
    await (await api(`/api/groups/${groupId}`, { cookie: ana })).json(),
  );
  B = detail.participants.find((p) => p.displayName === "Bo")!.id;
  R = ParticipantSchema.parse(
    await (
      await api(`/api/groups/${groupId}/participants`, {
        cookie: ana,
        body: { displayName: "Rahul" },
      })
    ).json(),
  ).id;
});

afterAll(async () => {
  await ctx?.stop();
});

describe("activity feed", () => {
  it("records joins, then expenses and payments newest first, with copied facts", async () => {
    const created = ExpenseDetailSchema.parse(
      await (
        await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: dinner([A, B]) })
      ).json(),
    );
    await api(`/api/groups/${groupId}/expenses/${created.id}`, {
      method: "PUT",
      cookie: bo,
      body: dinner([A, B, R], "Dinner and dessert"),
    });
    const payment = SettlementSchema.parse(
      await (
        await api(`/api/groups/${groupId}/settlements`, {
          cookie: bo,
          body: { fromId: B, toId: A, amountCents: 1000 },
        })
      ).json(),
    );
    await api(`/api/groups/${groupId}/settlements/${payment.id}`, { method: "DELETE", cookie: bo });
    await api(`/api/groups/${groupId}/expenses/${created.id}`, { method: "DELETE", cookie: ana });

    const { activities } = await feed();
    expect(activities.map((a) => a.kind)).toEqual([
      "expense.deleted",
      "payment.removed",
      "payment.recorded",
      "expense.edited",
      "expense.added",
      "member.joined",
      "member.joined",
    ]);
    const [deleted, , recorded, edited, added] = activities as [
      Activity,
      Activity,
      Activity,
      Activity,
      Activity,
    ];
    expect(added).toMatchObject({
      actorId: A,
      subjectId: created.id,
      data: { description: "Dinner", totalCents: 3000, currency: "USD", payerId: A },
    });
    expect(edited).toMatchObject({ actorId: B, data: { description: "Dinner and dessert" } });
    // The deleted entry still reads correctly after the expense is gone.
    expect(deleted.data).toMatchObject({ description: "Dinner and dessert", totalCents: 3000 });
    expect(recorded).toMatchObject({
      kind: "payment.recorded",
      data: { fromId: B, toId: A, amountCents: 1000 },
    });
  });

  it("marks what involves the caller", async () => {
    const { activities } = await feed(cy);
    const byKind = (k: string) => activities.find((a) => a.kind === k)!;
    // Cy was on none of the bills or payments, only joined.
    expect(byKind("expense.added").involvesMe).toBe(false);
    expect(byKind("payment.recorded").involvesMe).toBe(false);
    expect(activities.filter((a) => a.kind === "member.joined").some((a) => a.involvesMe)).toBe(
      true,
    );

    const forBo = (await feed(bo)).activities;
    expect(forBo.find((a) => a.kind === "expense.added")!.involvesMe).toBe(true);
  });

  it("pages with a cursor and rejects a bad one", async () => {
    const first = await feed(ana, "?limit=3");
    expect(first.activities).toHaveLength(3);
    expect(first.next).not.toBeNull();
    const second = await feed(ana, `?limit=3&cursor=${first.next!}`);
    const third = await feed(ana, `?limit=3&cursor=${second.next!}`);
    const ids = [...first.activities, ...second.activities, ...third.activities].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(third.next).toBeNull();
    expect(ids).toEqual((await feed()).activities.map((a) => a.id));

    expect(
      (await api(`/api/groups/${groupId}/activity?cursor=garbage`, { cookie: ana })).status,
    ).toBe(400);
    expect((await api(`/api/groups/${groupId}/activity?limit=500`, { cookie: ana })).status).toBe(
      400,
    );
  });

  it("resolves merged placeholders to the account and records the merge", async () => {
    ExpenseDetailSchema.parse(
      await (
        await api(`/api/groups/${groupId}/expenses`, {
          cookie: ana,
          body: { ...dinner([A, R], "Taxi"), payerId: R },
        })
      ).json(),
    );
    await api(`/api/groups/${groupId}/participants/${R}/merge`, {
      cookie: ana,
      body: { intoParticipantId: B },
    });
    const { activities } = await feed(bo);
    expect(activities[0]).toMatchObject({
      kind: "member.merged",
      data: { placeholderName: "Rahul", intoId: B },
      involvesMe: true,
    });
    const taxi = activities.find(
      (a) => a.kind === "expense.added" && a.data.description === "Taxi",
    )!;
    expect(taxi.kind === "expense.added" && taxi.data.payerId).toBe(B);
    expect(taxi.involvesMe).toBe(true);
  });

  it("is for members only", async () => {
    expect((await api(`/api/groups/${groupId}/activity`, { cookie: outsider })).status).toBe(404);
    expect((await api(`/api/groups/${groupId}/activity`)).status).toBe(401);
  });

  it("records nothing for a request that fails", async () => {
    const before = (await feed()).activities.length;
    const bad = await api(`/api/groups/${groupId}/settlements`, {
      cookie: ana,
      body: { fromId: A, toId: "00000000-0000-4000-8000-000000000000", amountCents: 5 },
    });
    expect(bad.status).toBe(400);
    expect((await feed()).activities.length).toBe(before);
  });
});
