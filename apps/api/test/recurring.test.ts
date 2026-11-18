import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@billsplit/db";
import {
  BalancesResponseSchema,
  ExpenseListResponseSchema,
  GroupDetailSchema,
  InviteSchema,
  ParticipantSchema,
  RecurringExpenseSchema,
  RecurringListResponseSchema,
  type CreateRecurringBody,
  type RecurringTemplate,
} from "@billsplit/contracts";
import { addDays, occurrenceDate, todayUtc } from "../src/lib/schedule.js";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = ""; // owner
let bo = "";
let outsider = "";
let groupId = "";
let A = "";
let B = "";

const today = todayUtc();
const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);
const base = () => `/api/groups/${groupId}/recurring`;

const rent = (amountCents = 200_000, people = [A, B], payerId = A): RecurringTemplate => ({
  description: "Rent",
  payerId,
  items: [
    { name: "Rent", amountCents, quantity: 1, split: { kind: "equal", participantIds: people } },
  ],
  adjustments: [],
});

async function create(body: Partial<CreateRecurringBody> = {}, cookie = ana) {
  const res = await api(base(), {
    cookie,
    body: { expense: rent(), frequency: "monthly", startOn: today, ...body },
  });
  if (res.status !== 201) throw new Error(`create failed ${res.status}: ${await res.text()}`);
  return RecurringExpenseSchema.parse(await res.json());
}

const get = async (id: string) =>
  RecurringExpenseSchema.parse(await (await api(`${base()}/${id}`, { cookie: ana })).json());

/** Expenses a schedule has posted, oldest first. */
async function postedBy(id: string) {
  const list = ExpenseListResponseSchema.parse(
    await (await api(`/api/groups/${groupId}/expenses`, { cookie: ana })).json(),
  );
  const rows = await ctx.db.db
    .select({ id: schema.expenses.id, n: schema.expenses.recurringOccurrence })
    .from(schema.expenses)
    .where(eq(schema.expenses.recurringExpenseId, id));
  const ids = new Set(rows.map((r) => r.id));
  return list.expenses
    .filter((e) => ids.has(e.id))
    .sort((a, b) => (a.spentOn < b.spentOn ? -1 : 1));
}

beforeAll(async () => {
  ctx = await startTestContext();
  [ana, bo, outsider] = await Promise.all([
    signUpVerified(ctx, "Ana", "ana@example.com"),
    signUpVerified(ctx, "Bo", "bo@example.com"),
    signUpVerified(ctx, "Ola", "ola@example.com"),
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
});

afterAll(async () => {
  await ctx?.stop();
});

describe("posting", () => {
  it("posts a bill due today straight away and schedules the next one", async () => {
    const r = await create();
    expect(r).toMatchObject({
      status: "active",
      postedCount: 1,
      totalCents: 200_000,
      nextOn: occurrenceDate({ frequency: "monthly", interval: 1, startOn: today }, 1),
      createdById: A,
    });
    const posted = await postedBy(r.id);
    expect(posted.map((e) => e.spentOn)).toEqual([today]);
    expect(posted[0]!.shares).toEqual(
      expect.arrayContaining([
        { participantId: A, paidCents: 200_000, owedCents: 100_000 },
        { participantId: B, paidCents: 0, owedCents: 100_000 },
      ]),
    );
    const balances = BalancesResponseSchema.parse(
      await (await api(`/api/groups/${groupId}/balances`, { cookie: ana })).json(),
    );
    expect(balances.transfers).toContainEqual({ fromId: B, toId: A, amountCents: 100_000 });
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });

  it("catches up missed occurrences with their own dates, exactly once", async () => {
    const start = addDays(today, -20);
    const r = await create({ frequency: "weekly", startOn: start });
    // Due on create: start, +7, +14 (all on or before today).
    expect(r.postedCount).toBe(3);

    const later = addDays(start, 7 * 6);
    // Two runs at once (two API instances) still post each occurrence once.
    const [x, y] = await Promise.all([ctx.recurring.postDue(later), ctx.recurring.postDue(later)]);
    expect(x + y).toBe(4);
    expect(await ctx.recurring.postDue(later)).toBe(0);
    expect((await postedBy(r.id)).map((e) => e.spentOn)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(start, 7 * n)),
    );
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });

  it("posts nothing before the first date", async () => {
    const r = await create({ startOn: addDays(today, 10) });
    expect(r.postedCount).toBe(0);
    expect(await ctx.recurring.postDue(addDays(today, 9))).toBe(0);
    expect(await ctx.recurring.postDue(addDays(today, 10))).toBe(1);
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });

  it("emails everyone on the bill, the person who set it up included", async () => {
    await ctx.notifier.idle();
    const before = ctx.mailer.sent.length;
    const r = await create({ startOn: today });
    await ctx.notifier.idle();
    const mail = ctx.mailer.sent.slice(before);
    expect(mail.map((m) => m.to).sort()).toEqual(["ana@example.com", "bo@example.com"]);
    expect(mail[0]!.subject).toBe("Rent posted in Flat 4B");
    expect(mail[0]!.text).toContain('The recurring expense "Rent" ($2,000.00) was posted.');
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });
});

describe("pause, skip, edit, end", () => {
  it("skips the next posting", async () => {
    const start = addDays(today, 1);
    const r = await create({ frequency: "weekly", startOn: start });
    const skipped = RecurringExpenseSchema.parse(
      await (await api(`${base()}/${r.id}/skip`, { cookie: ana, body: {} })).json(),
    );
    expect(skipped.nextOn).toBe(addDays(start, 7));
    expect(await ctx.recurring.postDue(addDays(start, 7))).toBe(1);
    expect((await postedBy(r.id)).map((e) => e.spentOn)).toEqual([addDays(start, 7)]);
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });

  it("does not post while paused, and resumes from today without the backlog", async () => {
    const r = await create({ frequency: "weekly", startOn: addDays(today, -14) });
    expect(r.postedCount).toBe(3);
    const paused = RecurringExpenseSchema.parse(
      await (
        await api(`${base()}/${r.id}`, { method: "PATCH", cookie: ana, body: { paused: true } })
      ).json(),
    );
    expect(paused.status).toBe("paused");
    expect(await ctx.recurring.postDue(addDays(today, 30), r.id)).toBe(0);

    // Pretend three weeks went by while paused: rewind the schedule's pointer by hand.
    await ctx.db.db
      .update(schema.recurringExpenses)
      .set({ nextOccurrence: 0, nextOn: addDays(today, -14) })
      .where(eq(schema.recurringExpenses.id, r.id));
    const resumed = RecurringExpenseSchema.parse(
      await (
        await api(`${base()}/${r.id}`, { method: "PATCH", cookie: ana, body: { paused: false } })
      ).json(),
    );
    // Occurrence 2 (today) was already posted, so it continues with occurrence 3.
    expect(resumed).toMatchObject({ status: "active", nextOn: addDays(today, 7), postedCount: 3 });
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });

  it("changes future postings only", async () => {
    const r = await create({ startOn: today });
    const edited = RecurringExpenseSchema.parse(
      await (
        await api(`${base()}/${r.id}`, {
          method: "PATCH",
          cookie: ana,
          body: { expense: { ...rent(210_000), description: "Rent (new lease)" } },
        })
      ).json(),
    );
    expect(edited).toMatchObject({ totalCents: 210_000, description: "Rent (new lease)" });
    await ctx.recurring.postDue(edited.nextOn!);
    const posted = await postedBy(r.id);
    expect(posted.map((e) => [e.description, e.totalCents])).toEqual([
      ["Rent", 200_000],
      ["Rent (new lease)", 210_000],
    ]);
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });

  it("stops at the end date", async () => {
    const r = await create({
      frequency: "weekly",
      startOn: addDays(today, 1),
      endOn: addDays(today, 8),
    });
    expect(await ctx.recurring.postDue(addDays(today, 60), r.id)).toBe(2);
    const ended = await get(r.id);
    expect(ended).toMatchObject({ status: "ended", nextOn: null, postedCount: 2 });
    expect((await api(`${base()}/${r.id}/skip`, { cookie: ana, body: {} })).status).toBe(409);
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });

  it("keeps posted expenses when the schedule is stopped", async () => {
    const r = await create({ startOn: today });
    expect((await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana })).status).toBe(204);
    expect((await api(`${base()}/${r.id}`, { cookie: ana })).status).toBe(404);
    expect(await postedBy(r.id)).toHaveLength(1);
    expect(await ctx.recurring.postDue(addDays(today, 400))).toBe(0);
  });
});

describe("people changing", () => {
  it("pauses with a reason when someone on the bill is removed", async () => {
    const wifi = ParticipantSchema.parse(
      await (
        await api(`/api/groups/${groupId}/participants`, {
          cookie: ana,
          body: { displayName: "Sublet" },
        })
      ).json(),
    );
    const r = await create({ expense: rent(6000, [A, B, wifi.id]), startOn: addDays(today, 3) });
    expect(
      (
        await api(`/api/groups/${groupId}/participants/${wifi.id}`, {
          method: "DELETE",
          cookie: ana,
        })
      ).status,
    ).toBe(204);
    expect(await ctx.recurring.postDue(addDays(today, 3))).toBe(0);
    expect(await get(r.id)).toMatchObject({
      status: "paused",
      pausedReason: "Everyone in the split must be in the group",
    });
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });

  it("bills the account a placeholder was merged into", async () => {
    const temp = ParticipantSchema.parse(
      await (
        await api(`/api/groups/${groupId}/participants`, {
          cookie: ana,
          body: { displayName: "B?" },
        })
      ).json(),
    );
    const r = await create({ expense: rent(5000, [A, temp.id]), startOn: addDays(today, 2) });
    const merged = await api(`/api/groups/${groupId}/participants/${temp.id}/merge`, {
      cookie: ana,
      body: { intoParticipantId: B },
    });
    expect(merged.status).toBe(200);
    expect(await ctx.recurring.postDue(addDays(today, 2))).toBe(1);
    const [posted] = await postedBy(r.id);
    expect(posted!.shares.map((s) => s.participantId).sort()).toEqual([A, B].sort());
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });
});

describe("validation and access", () => {
  const bad = (body: Record<string, unknown>) =>
    api(base(), {
      cookie: ana,
      body: { expense: rent(), frequency: "monthly", startOn: today, ...body },
    });

  it("rejects bad dates, cadences and splits", async () => {
    expect((await bad({ startOn: addDays(today, -32) })).status).toBe(400);
    expect((await bad({ endOn: addDays(today, -1) })).status).toBe(400);
    expect((await bad({ interval: 13 })).status).toBe(400);
    expect((await bad({ frequency: "daily" })).status).toBe(400);
    expect(
      (await bad({ expense: rent(1000, [A, "00000000-0000-4000-8000-000000000000"]) })).status,
    ).toBe(400);
    const rows = await ctx.db.db
      .select()
      .from(schema.recurringExpenses)
      .where(and(eq(schema.recurringExpenses.groupId, groupId)));
    expect(rows.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it("lets only the creator or the owner change a schedule", async () => {
    const r = await create({ startOn: addDays(today, 5) }, bo);
    const mine = await create({ startOn: addDays(today, 5) });
    expect(
      (await api(`${base()}/${mine.id}`, { method: "PATCH", cookie: bo, body: { paused: true } }))
        .status,
    ).toBe(403);
    expect((await api(`${base()}/${mine.id}/skip`, { cookie: bo, body: {} })).status).toBe(403);
    expect((await api(`${base()}/${mine.id}`, { method: "DELETE", cookie: bo })).status).toBe(403);
    // Owner may manage Bo's.
    expect(
      (await api(`${base()}/${r.id}`, { method: "PATCH", cookie: ana, body: { paused: true } }))
        .status,
    ).toBe(200);
    const list = RecurringListResponseSchema.parse(
      await (await api(base(), { cookie: bo })).json(),
    );
    expect(list.recurring.map((x) => x.id).sort()).toEqual([r.id, mine.id].sort());
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: bo });
    await api(`${base()}/${mine.id}`, { method: "DELETE", cookie: ana });
  });

  it("hides schedules from non-members and answers 404 for malformed ids", async () => {
    const r = await create({ startOn: addDays(today, 5) });
    expect((await api(base(), { cookie: outsider })).status).toBe(404);
    expect((await api(`${base()}/${r.id}`, { cookie: outsider })).status).toBe(404);
    expect((await api(`${base()}/not-a-uuid`, { cookie: ana })).status).toBe(404);
    expect((await api(base())).status).toBe(401);
    await api(`${base()}/${r.id}`, { method: "DELETE", cookie: ana });
  });
});
