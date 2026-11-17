import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@billsplit/db";
import {
  AcceptInviteResponseSchema,
  AuditLogResponseSchema,
  ClaimLinkSchema,
  CreateReceiptResponseSchema,
  GroupDetailSchema,
  InviteSchema,
  ParticipantSchema,
  ReceiptClaimsResponseSchema,
  type GroupDetail,
} from "@billsplit/contracts";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = "";
let bo = "";
let cy = "";

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);

const OCR = {
  merchant: "Corner Bistro",
  date: "2026-11-14",
  currency: "USD",
  items: [0, 1, 2].map((i) => ({
    description: `Dish ${i}`,
    quantity: 1,
    unitPriceCents: 1000,
    totalPriceCents: 1000,
    confidence: "high" as const,
  })),
  subtotalCents: 3000,
  taxCents: null,
  tipCents: null,
  feeCents: null,
  discountCents: null,
  totalCents: 3000,
  reconciliation: {
    matches: true,
    itemsSumCents: 3000,
    computedTotalCents: 3000,
    discrepancyCents: 0,
    reason: null,
  },
  model: "sample:bistro-dinner",
  provider: "fixture" as const,
};

/** A group owned by Ana with Bo as a member and one placeholder. */
async function setup(name: string) {
  const group = GroupDetailSchema.parse(
    await (await api("/api/groups", { cookie: ana, body: { name } })).json(),
  );
  const invite = InviteSchema.parse(
    await (await api(`/api/groups/${group.id}/invites`, { cookie: ana, body: {} })).json(),
  );
  await api(`/api/invites/${invite.code}/accept`, { cookie: bo, body: {} });
  const ghost = ParticipantSchema.parse(
    await (
      await api(`/api/groups/${group.id}/participants`, {
        cookie: ana,
        body: { displayName: "Rahul" },
      })
    ).json(),
  );
  const detail = GroupDetailSchema.parse(
    await (await api(`/api/groups/${group.id}`, { cookie: ana })).json(),
  );
  const boId = detail.participants.find((p) => p.displayName === "Bo")!.id;
  return { group: detail, ghostId: ghost.id, boId };
}

async function readyReceipt(groupId: string): Promise<string> {
  const res = await api(`/api/groups/${groupId}/receipts`, {
    cookie: ana,
    body: { contentType: "image/jpeg", sizeBytes: 2048 },
  });
  const { receipt } = CreateReceiptResponseSchema.parse(await res.json());
  await ctx.db.db
    .update(schema.receipts)
    .set({ status: "ready", ocr: OCR })
    .where(eq(schema.receipts.id, receipt.id));
  return receipt.id;
}

const merge = async (groupId: string, pid: string, into: string, cookie = ana) =>
  await api(`/api/groups/${groupId}/participants/${pid}/merge`, {
    cookie,
    body: { intoParticipantId: into },
  });

const claim = (group: GroupDetail, receiptId: string, participantId: string, items: unknown[]) =>
  api(`/api/groups/${group.id}/receipts/${receiptId}/claims`, {
    method: "PUT",
    cookie: ana,
    body: { participantId, items },
  });

const claimsOf = async (groupId: string, receiptId: string) =>
  ReceiptClaimsResponseSchema.parse(
    await (
      await api(`/api/groups/${groupId}/receipts/${receiptId}/claims`, { cookie: ana })
    ).json(),
  ).claims;

const auditOf = async (groupId: string, cookie = ana) => {
  const res = await api(`/api/groups/${groupId}/audit-log`, { cookie });
  return {
    status: res.status,
    entries: res.ok ? AuditLogResponseSchema.parse(await res.json()).entries : [],
  };
};

beforeAll(async () => {
  ctx = await startTestContext();
  [ana, bo, cy] = await Promise.all([
    signUpVerified(ctx, "Ana", "ana@example.com"),
    signUpVerified(ctx, "Bo", "bo@example.com"),
    signUpVerified(ctx, "Cy", "cy@example.com"),
  ]);
});

afterAll(async () => {
  await ctx?.stop();
});

describe("merging a placeholder", () => {
  it("is idempotent: repeating the same merge succeeds and changes nothing", async () => {
    const { group, ghostId, boId } = await setup("Idempotent");
    expect((await merge(group.id, ghostId, boId)).status).toBe(200);
    expect((await merge(group.id, ghostId, boId)).status).toBe(200);
    const { entries } = await auditOf(group.id);
    expect(entries.filter((e) => e.action === "participant.merged")).toHaveLength(1);
  });

  it("refuses to merge an already-merged placeholder into someone else", async () => {
    const { group, ghostId, boId } = await setup("Twice");
    expect((await merge(group.id, ghostId, boId)).status).toBe(200);
    expect((await merge(group.id, ghostId, group.myParticipantId)).status).toBe(409);
  });

  it("runs simultaneous merges one at a time: one merges, the others see it done or refused", async () => {
    const { group, ghostId, boId } = await setup("Race");
    const results = await Promise.all([
      merge(group.id, ghostId, boId),
      merge(group.id, ghostId, boId),
      merge(group.id, ghostId, group.myParticipantId),
    ]);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    const [row] = await ctx.db.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, ghostId));
    expect([boId, group.myParticipantId]).toContain(row!.mergedIntoId);
    const { entries } = await auditOf(group.id);
    expect(entries.filter((e) => e.action === "participant.merged")).toHaveLength(1);
  });

  it("validates ids and roles", async () => {
    const { group, ghostId, boId } = await setup("Validation");
    expect((await merge(group.id, "nope", boId)).status).toBe(404);
    expect((await merge(group.id, ghostId, "00000000-0000-4000-8000-000000000000")).status).toBe(
      404,
    );
    expect((await merge(group.id, ghostId, ghostId)).status).toBe(400);
    expect((await merge(group.id, boId, group.myParticipantId)).status).toBe(409);
    expect((await merge(group.id, ghostId, boId, bo)).status).toBe(403);
    const other = await setup("Elsewhere");
    expect((await merge(group.id, other.ghostId, boId)).status).toBe(404);
  });
});

describe("receipt claims follow the merge", () => {
  it("moves the placeholder's claims to the account and drops duplicates on shared lines", async () => {
    const { group, ghostId, boId } = await setup("Claims");
    const receiptId = await readyReceipt(group.id);
    expect(
      (await claim(group, receiptId, ghostId, [{ itemIndex: 0 }, { itemIndex: 1, percent: 30 }]))
        .status,
    ).toBe(200);
    expect(
      (await claim(group, receiptId, boId, [{ itemIndex: 1, percent: 50 }, { itemIndex: 2 }]))
        .status,
    ).toBe(200);

    expect((await merge(group.id, ghostId, boId)).status).toBe(200);

    const claims = await claimsOf(group.id, receiptId);
    expect(claims.every((c) => c.participantId === boId)).toBe(true);
    // Bo's own claim on line 1 stands; the placeholder's 30% on it is dropped.
    expect(claims.map((c) => [c.itemIndex, c.percent])).toEqual([
      [0, null],
      [1, 50],
      [2, null],
    ]);
    const entry = (await auditOf(group.id)).entries.find((e) => e.action === "participant.merged")!;
    expect(entry.details).toMatchObject({
      placeholderName: "Rahul",
      intoName: "Bo",
      claimsMoved: 1,
      claimsDropped: 1,
    });
  });

  it("guests can no longer claim as the merged placeholder", async () => {
    const { group, ghostId, boId } = await setup("Guest after merge");
    const receiptId = await readyReceipt(group.id);
    const link = ClaimLinkSchema.parse(
      await (
        await api(`/api/groups/${group.id}/receipts/${receiptId}/claim-link`, {
          cookie: ana,
          body: {},
        })
      ).json(),
    );
    await merge(group.id, ghostId, boId);
    const res = await api(`/api/claim-links/${link.token}/claims`, {
      method: "PUT",
      body: { participantId: ghostId, items: [{ itemIndex: 0 }] },
    });
    expect(res.status).toBe(404);
  });
});

describe("taking over a placeholder through an invite", () => {
  const personalInvite = async (groupId: string, participantId: string) =>
    InviteSchema.parse(
      await (
        await api(`/api/groups/${groupId}/invites`, { cookie: ana, body: { participantId } })
      ).json(),
    );

  it("records who claimed which placeholder", async () => {
    const { group, ghostId } = await setup("Claim audit");
    const invite = await personalInvite(group.id, ghostId);
    const res = await api(`/api/invites/${invite.code}/accept`, { cookie: cy, body: {} });
    expect(AcceptInviteResponseSchema.parse(await res.json()).participantId).toBe(ghostId);
    const entry = (await auditOf(group.id)).entries.find(
      (e) => e.action === "participant.claimed",
    )!;
    expect(entry.actorParticipantId).toBe(ghostId);
    expect(entry.details).toMatchObject({ placeholderId: ghostId, placeholderName: "Rahul" });
  });

  it("is refused once the placeholder was merged, even with an invite issued before", async () => {
    const { group, ghostId, boId } = await setup("Merged then invited");
    const invite = await personalInvite(group.id, ghostId);
    // The merge unbinds the invite, so it becomes an ordinary join link.
    await merge(group.id, ghostId, boId);
    const res = AcceptInviteResponseSchema.parse(
      await (await api(`/api/invites/${invite.code}/accept`, { cookie: cy, body: {} })).json(),
    );
    expect(res.participantId).not.toBe(ghostId);
    const [row] = await ctx.db.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, ghostId));
    expect(row!.userId).toBeNull();
  });

  it("a merge racing an invite accept leaves exactly one of them applied", async () => {
    const { group, ghostId, boId } = await setup("Merge vs accept");
    const invite = await personalInvite(group.id, ghostId);
    const [merged, accepted] = await Promise.all([
      merge(group.id, ghostId, boId),
      api(`/api/invites/${invite.code}/accept`, { cookie: cy, body: {} }),
    ]);
    expect(merged.status).toBeLessThan(500);
    expect(accepted.status).toBeLessThan(500);
    const [row] = await ctx.db.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, ghostId));
    // Either Cy took the placeholder over, or it was merged into Bo; never both.
    expect(Boolean(row!.userId) !== Boolean(row!.mergedIntoId)).toBe(true);
  });

  it("accepting the same invite twice at once makes one member, not an error", async () => {
    const { group } = await setup("Double accept");
    const invite = InviteSchema.parse(
      await (await api(`/api/groups/${group.id}/invites`, { cookie: ana, body: {} })).json(),
    );
    const results = await Promise.all(
      [1, 2, 3].map(
        async () => await api(`/api/invites/${invite.code}/accept`, { cookie: cy, body: {} }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const ids = await Promise.all(
      results.map(async (r) => AcceptInviteResponseSchema.parse(await r.json()).participantId),
    );
    expect(new Set(ids).size).toBe(1);
  });
});

describe("the audit log", () => {
  it("is for the owner only", async () => {
    const { group } = await setup("Audit access");
    expect((await auditOf(group.id, bo)).status).toBe(403);
    expect((await auditOf(group.id, cy)).status).toBe(404);
    expect((await auditOf(group.id)).status).toBe(200);
  });
});
