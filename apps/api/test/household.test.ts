import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AwayPeriodSchema,
  ExpenseDetailSchema,
  GroupDetailSchema,
  HouseholdResidentSchema,
  HouseholdResponseSchema,
  HouseholdSplitSchema,
  InviteSchema,
  ParticipantSchema,
  RecurringExpenseSchema,
  type ExpenseInput,
  type HouseholdSplitInput,
} from "@billsplit/contracts";
import { addDays, occurrenceDate, todayUtc } from "../src/lib/schedule.js";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = ""; // owner
let bo = "";
let groupId = "";
let A = "";
let B = "";

const NOV = { from: "2026-11-01", to: "2026-11-30" };
const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);
const h = (path = "") => `/api/groups/${groupId}/household${path}`;

const resident = (pid: string, body: unknown, cookie = ana) =>
  api(h(`/residents/${pid}`), { method: "PATCH", cookie, body });

async function snapshot(basis: "rent" | "usage", period = NOV): Promise<HouseholdSplitInput> {
  const res = await api(h(`/split?basis=${basis}&from=${period.from}&to=${period.to}`), {
    cookie: ana,
  });
  expect(res.status).toBe(200);
  return HouseholdSplitSchema.parse(await res.json());
}

const bill = (
  split: HouseholdSplitInput,
  amountCents: number,
  description = "Rent",
): ExpenseInput => ({
  description,
  spentOn: split.period.from,
  payerId: A,
  items: [{ name: description, amountCents, quantity: 1, split }],
  adjustments: [],
});

async function addExpense(input: ExpenseInput) {
  const res = await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: input });
  expect(res.status).toBe(201);
  return ExpenseDetailSchema.parse(await res.json());
}
const owed = (e: { shares: { participantId: string; owedCents: number }[] }) =>
  Object.fromEntries(e.shares.map((s) => [s.participantId, s.owedCents]));

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
});

afterAll(async () => {
  await ctx?.stop();
});

describe("household settings", () => {
  it("defaults everyone to weight 1, there the whole time", async () => {
    const house = HouseholdResponseSchema.parse(await (await api(h(), { cookie: bo })).json());
    expect(house.residents).toEqual(
      expect.arrayContaining([
        { participantId: A, roomWeight: 1, movedInOn: null, movedOutOn: null },
        { participantId: B, roomWeight: 1, movedInOn: null, movedOutOn: null },
      ]),
    );
    expect(house.away).toEqual([]);
  });

  it("lets people set their own details and the owner set anyone's", async () => {
    const mine = await resident(B, { roomWeight: 150 }, bo);
    expect(HouseholdResidentSchema.parse(await mine.json())).toMatchObject({ roomWeight: 150 });
    expect((await resident(A, { roomWeight: 9 }, bo)).status).toBe(403);
    expect((await resident(B, { roomWeight: 100 })).status).toBe(200);
    expect((await resident(A, { roomWeight: 200 })).status).toBe(200);
    expect((await resident(A, { movedInOn: "2026-11-20", movedOutOn: "2026-11-10" })).status).toBe(
      400,
    );
    expect((await resident(A, {})).status).toBe(400);
    expect((await resident("not-a-uuid", { roomWeight: 1 })).status).toBe(404);
  });

  it("records trips for yourself, or for anyone as owner", async () => {
    const trip = { participantId: B, from: "2026-11-11", to: "2026-11-20", note: "Home" };
    expect(
      (await api(h("/away"), { cookie: bo, body: { ...trip, participantId: A } })).status,
    ).toBe(403);
    expect(
      (await api(h("/away"), { cookie: bo, body: { ...trip, to: "2026-11-01" } })).status,
    ).toBe(400);
    const res = await api(h("/away"), { cookie: bo, body: trip });
    expect(res.status).toBe(201);
    const away = AwayPeriodSchema.parse(await res.json());
    const house = HouseholdResponseSchema.parse(await (await api(h(), { cookie: ana })).json());
    expect(house.away).toEqual([{ ...away, note: "Home" }]);
  });
});

describe("household bills", () => {
  it("splits rent by room weight, ignoring trips", async () => {
    const split = await snapshot("rent");
    expect(split.residents).toEqual(
      expect.arrayContaining([
        { participantId: A, weight: 200 },
        { participantId: B, weight: 100, away: [{ from: "2026-11-11", to: "2026-11-20" }] },
      ]),
    );
    const e = await addExpense(bill(split, 300_000));
    expect(owed(e)).toEqual({ [A]: 200_000, [B]: 100_000 });
  });

  it("splits utilities by days present", async () => {
    const e = await addExpense(bill(await snapshot("usage"), 9_000, "Power"));
    // Bo was away 10 of 30 days: 20 vs 30 person-days.
    expect(owed(e)).toEqual({ [A]: 5_400, [B]: 3_600 });
  });

  it("keeps saved bills as they were when the household changes", async () => {
    const e = await addExpense(bill(await snapshot("rent"), 300_000));
    await resident(A, { roomWeight: 100 });
    const again = ExpenseDetailSchema.parse(
      await (await api(`/api/groups/${groupId}/expenses/${e.id}`, { cookie: ana })).json(),
    );
    expect(owed(again)).toEqual({ [A]: 200_000, [B]: 100_000 });
    await resident(A, { roomWeight: 200 });
  });

  it("rejects malformed household splits and queries", async () => {
    const split = await snapshot("rent");
    const backwards = { ...split, period: { from: "2026-11-30", to: "2026-11-01" } };
    expect(
      (await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: bill(backwards, 100) }))
        .status,
    ).toBe(400);
    const stranger = {
      ...split,
      residents: [{ participantId: "00000000-0000-4000-8000-000000000000" }],
    };
    expect(
      (await api(`/api/groups/${groupId}/expenses`, { cookie: ana, body: bill(stranger, 100) }))
        .status,
    ).toBe(400);
    expect(
      (await api(h("/split?basis=rent&from=2026-11-30&to=2026-11-01"), { cookie: ana })).status,
    ).toBe(400);
    expect(
      (await api(h("/split?basis=water&from=2026-11-01&to=2026-11-30"), { cookie: ana })).status,
    ).toBe(400);
  });
});

describe("repeating household rent", () => {
  it("prorates a roommate who moves in mid-period, without editing the schedule", async () => {
    const start = addDays(todayUtc(), 1);
    const cadence = { frequency: "monthly" as const, interval: 1, startOn: start };
    const firstEnd = addDays(occurrenceDate(cadence, 1), -1);
    const template = bill(await snapshot("rent", { from: start, to: firstEnd }), 300_000);
    // JSON drops the undefined date: a schedule's template has none.
    const expense = { ...template, spentOn: undefined };
    const res = await api(`/api/groups/${groupId}/recurring`, {
      cookie: ana,
      body: { expense, frequency: "monthly", startOn: start },
    });
    expect(res.status).toBe(201);
    const r = RecurringExpenseSchema.parse(await res.json());

    // A new roommate (a placeholder) moves in 10 days into the second period.
    const cy = ParticipantSchema.parse(
      await (
        await api(`/api/groups/${groupId}/participants`, {
          cookie: ana,
          body: { displayName: "Cy" },
        })
      ).json(),
    );
    const second = occurrenceDate(cadence, 1);
    const secondEnd = addDays(occurrenceDate(cadence, 2), -1);
    expect((await resident(cy.id, { movedInOn: addDays(second, 10) })).status).toBe(200);

    expect(await ctx.recurring.postDue(second, r.id)).toBe(2);
    const list = (await (await api(`/api/groups/${groupId}/expenses`, { cookie: ana })).json()) as {
      expenses: { id: string; spentOn: string; recurringId: string | null }[];
    };
    const posted = list.expenses
      .filter((e) => e.recurringId === r.id)
      .sort((a, b) => (a.spentOn < b.spentOn ? -1 : 1));
    expect(posted.map((e) => e.spentOn)).toEqual([start, second]);

    const detail = async (id: string) =>
      ExpenseDetailSchema.parse(
        await (await api(`/api/groups/${groupId}/expenses/${id}`, { cookie: ana })).json(),
      );
    const [one, two] = [await detail(posted[0]!.id), await detail(posted[1]!.id)];
    expect(Object.keys(owed(one)).sort()).toEqual([A, B].sort());
    const split = two.items[0]!.split as HouseholdSplitInput;
    expect(split.period).toEqual({ from: second, to: secondEnd });
    const days = (Date.parse(secondEnd) - Date.parse(second)) / 86_400_000 + 1;
    // Weights: Ana 200 × days, Bo 100 × days, Cy 1 × (days - 10).
    const w = { a: 200 * days, b: 100 * days, c: days - 10 };
    const total = w.a + w.b + w.c;
    const shares = owed(two);
    expect(Math.abs(shares[cy.id]! - (300_000 * w.c) / total)).toBeLessThan(1);
    expect(shares[A]! + shares[B]! + shares[cy.id]!).toBe(300_000);
    await api(`/api/groups/${groupId}/recurring/${r.id}`, { method: "DELETE", cookie: ana });
  });
});
