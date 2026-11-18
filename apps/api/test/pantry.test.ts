import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@billsplit/db";
import {
  ExpenseDetailSchema,
  GroupDetailSchema,
  InviteSchema,
  PantryListResponseSchema,
  PantryRunSchema,
  ParticipantSchema,
  type PantryRun,
} from "@billsplit/contracts";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = ""; // owner
let bo = "";
let groupId = "";
let A = "";
let B = "";
let R = ""; // placeholder

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);
const p = (path = "") => `/api/groups/${groupId}/pantry${path}`;

async function stock(body: Record<string, unknown>, cookie = ana): Promise<PantryRun> {
  const res = await api(p(), { cookie, body });
  if (res.status !== 201) throw new Error(`stock failed ${res.status}: ${await res.text()}`);
  return PantryRunSchema.parse(await res.json());
}
const costco = () =>
  stock({
    description: "Costco run",
    payerId: A,
    boughtOn: "2026-11-18",
    items: [
      { name: "Milk ×6", amountCents: 1200 },
      { name: "Eggs ×24", amountCents: 900 },
      { name: "Foil", amountCents: 600 },
    ],
    taxCents: 270,
  });
const use = (run: PantryRun, item: number, pid: string, units: number, cookie = ana) =>
  api(p(`/${run.id}/items/${run.items[item]!.id}/uses/${pid}`), {
    method: "PUT",
    cookie,
    body: { units },
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
  B = detail.participants.find((x) => x.displayName === "Bo")!.id;
  R = ParticipantSchema.parse(
    await (
      await api(`/api/groups/${groupId}/participants`, {
        cookie: ana,
        body: { displayName: "Ravi" },
      })
    ).json(),
  ).id;
});

afterAll(async () => {
  await ctx?.stop();
});

describe("pantry", () => {
  it("stocks a run with items and a total", async () => {
    const run = await costco();
    expect(run).toMatchObject({
      status: "open",
      payerId: A,
      totalCents: 2970,
      createdById: A,
      expenseId: null,
    });
    expect(run.items.map((i) => i.name)).toEqual(["Milk ×6", "Eggs ×24", "Foil"]);
  });

  it("records what people used, idempotently, and lets the owner mark for placeholders", async () => {
    const run = await costco();
    expect((await use(run, 0, B, 2, bo)).status).toBe(200);
    expect((await use(run, 0, B, 2, bo)).status).toBe(200); // a retry changes nothing
    expect((await use(run, 0, A, 1, bo)).status).toBe(403);
    expect((await use(run, 0, R, 3)).status).toBe(200);
    expect((await use(run, 1, B, 1, bo)).status).toBe(200);
    expect((await use(run, 1, B, 0, bo)).status).toBe(200); // cleared
    const res = await use(run, 0, A, 1);
    const after = PantryRunSchema.parse(await res.json());
    expect(after.items[0]!.uses).toEqual(
      expect.arrayContaining([
        { participantId: B, units: 2 },
        { participantId: R, units: 3 },
        { participantId: A, units: 1 },
      ]),
    );
    expect(after.items[1]!.uses).toEqual([]);
    expect((await use(run, 0, B, 100, bo)).status).toBe(400);
  });

  it("settles into one expense split by use; unmarked items go to everyone who used something", async () => {
    const run = await costco();
    await use(run, 0, A, 1); // milk: Ana 1, Bo 2
    await use(run, 0, B, 2, bo);
    await use(run, 1, B, 1, bo); // eggs: Bo
    // Foil: nobody, so Ana and Bo share it.
    expect((await api(p(`/${run.id}/settle`), { cookie: bo, body: {} })).status).toBe(403);
    const res = await api(p(`/${run.id}/settle`), { cookie: ana, body: {} });
    expect(res.status).toBe(200);
    const settled = PantryRunSchema.parse(await res.json());
    expect(settled.status).toBe("settled");

    const expense = ExpenseDetailSchema.parse(
      await (
        await api(`/api/groups/${groupId}/expenses/${settled.expenseId}`, { cookie: ana })
      ).json(),
    );
    const owed = Object.fromEntries(expense.shares.map((s) => [s.participantId, s.owedCents]));
    // Milk 400/800, eggs 0/900, foil 300/300 -> items 700/2000; tax 270 in proportion.
    expect(expense.totalCents).toBe(2970);
    expect(owed).toEqual({ [A]: 770, [B]: 2200 });
    expect(expense).toMatchObject({ description: "Costco run", spentOn: "2026-11-18", payerId: A });

    expect((await api(p(`/${run.id}/settle`), { cookie: ana, body: {} })).status).toBe(409);
    expect((await use(run, 2, A, 1)).status).toBe(409);
    expect((await api(p(`/${run.id}`), { method: "DELETE", cookie: ana })).status).toBe(409);
  });

  it("settles twice at once into exactly one expense", async () => {
    const run = await costco();
    const before = await ctx.db.db.select().from(schema.expenses);
    const [x, y] = await Promise.all([
      api(p(`/${run.id}/settle`), { cookie: ana, body: {} }),
      api(p(`/${run.id}/settle`), { cookie: ana, body: {} }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const after = await ctx.db.db.select().from(schema.expenses);
    expect(after.length - before.length).toBe(1);
  });

  it("stocks from a scanned receipt's reviewed lines", async () => {
    const [receipt] = await ctx.db.db
      .insert(schema.receipts)
      .values({
        groupId,
        uploadedBy: B,
        status: "ready",
        contentType: "image/jpeg",
        sizeBytes: 10,
        originalKey: "x",
        ocr: {
          merchant: "Costco",
          date: "2026-11-15",
          currency: "USD",
          items: [
            {
              description: "Coffee",
              quantity: 1,
              unitPriceCents: 1800,
              totalPriceCents: 1800,
              confidence: "high",
            },
            {
              description: "Rice 20lb",
              quantity: 1,
              unitPriceCents: 2200,
              totalPriceCents: 2200,
              confidence: "high",
            },
          ],
          subtotalCents: 4000,
          taxCents: 0,
          tipCents: null,
          feeCents: null,
          discountCents: 500,
          totalCents: 3500,
          reconciliation: {
            matches: true,
            itemsSumCents: 4000,
            computedTotalCents: 3500,
            discrepancyCents: 0,
            reason: null,
          },
          model: "fixture",
          provider: "fixture",
        },
      })
      .returning({ id: schema.receipts.id });
    const run = await stock({ receiptId: receipt!.id }, bo);
    expect(run).toMatchObject({
      description: "Costco run",
      payerId: B,
      boughtOn: "2026-11-15",
      discountCents: 500,
      totalCents: 3500,
      receiptId: receipt!.id,
    });
    expect(run.items.map((i) => [i.name, i.amountCents])).toEqual([
      ["Coffee", 1800],
      ["Rice 20lb", 2200],
    ]);

    await ctx.db.db
      .update(schema.receipts)
      .set({ status: "processing" })
      .where(eq(schema.receipts.id, receipt!.id));
    expect((await api(p(), { cookie: bo, body: { receiptId: receipt!.id } })).status).toBe(409);
  });

  it("removes open runs, validates input and hides runs from outsiders", async () => {
    const run = await costco();
    expect((await api(p(`/${run.id}`), { method: "DELETE", cookie: bo })).status).toBe(403);
    expect((await api(p(`/${run.id}`), { method: "DELETE", cookie: ana })).status).toBe(204);
    const list = PantryListResponseSchema.parse(await (await api(p(), { cookie: bo })).json());
    expect(list.runs.map((r) => r.id)).not.toContain(run.id);
    expect(list.runs[0]!.status).toBe("open"); // open runs first

    expect(
      (await api(p(), { cookie: ana, body: { description: "x", payerId: A, items: [] } })).status,
    ).toBe(400);
    expect(
      (
        await api(p(), {
          cookie: ana,
          body: {
            description: "x",
            payerId: "00000000-0000-4000-8000-000000000000",
            items: [{ name: "a", amountCents: 1 }],
          },
        })
      ).status,
    ).toBe(400);
    expect((await api(p("/not-a-uuid/settle"), { cookie: ana, body: {} })).status).toBe(404);
    const outsider = await signUpVerified(ctx, "Ola", "ola@example.com");
    expect((await api(p(), { cookie: outsider })).status).toBe(404);
  });
});
