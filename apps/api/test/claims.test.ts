import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@billsplit/db";
import {
  AcceptInviteResponseSchema,
  CLAIM_LINK_MAX_GUESTS,
  ClaimLinkResponseSchema,
  ClaimLinkSchema,
  ClaimPageSchema,
  ClaimPersonSchema,
  CreateReceiptResponseSchema,
  GroupDetailSchema,
  InviteSchema,
  ParticipantSchema,
  ReceiptClaimsResponseSchema,
  type ClaimLink,
  type ReceiptClaim,
} from "@billsplit/contracts";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = "";
let bo = "";
let outsider = "";
let groupId = "";
let anaId = "";
let rahulId = ""; // placeholder
let receiptId = "";

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);

const item = (description: string, totalPriceCents: number) => ({
  description,
  quantity: 1,
  unitPriceCents: totalPriceCents,
  totalPriceCents,
  confidence: "high" as const,
});

const EXTRACTION = {
  merchant: "Corner Bistro",
  date: "2026-11-14",
  currency: "USD",
  items: [item("Margherita", 1800), item("Tiramisu", 900), item("Sparkling water", 400)],
  subtotalCents: 3100,
  taxCents: 250,
  tipCents: 600,
  feeCents: null,
  discountCents: null,
  totalCents: 3950,
};
const OCR = {
  ...EXTRACTION,
  reconciliation: {
    matches: true,
    itemsSumCents: 3100,
    computedTotalCents: 3950,
    discrepancyCents: 0,
    reason: null,
  },
  model: "sample:bistro-dinner",
  provider: "fixture" as const,
};

/** A receipt in the group, as the worker would leave it after reading it. */
async function readyReceipt(group = groupId, cookie = ana): Promise<string> {
  const res = await api(`/api/groups/${group}/receipts`, {
    cookie,
    body: { contentType: "image/jpeg", sizeBytes: 2048 },
  });
  expect(res.status).toBe(201);
  const { receipt } = CreateReceiptResponseSchema.parse(await res.json());
  await ctx.db.db
    .update(schema.receipts)
    .set({ status: "ready", ocr: OCR })
    .where(eq(schema.receipts.id, receipt.id));
  return receipt.id;
}

const linkPath = (id = receiptId) => `/api/groups/${groupId}/receipts/${id}/claim-link`;
const claimsPath = (id = receiptId) => `/api/groups/${groupId}/receipts/${id}/claims`;

async function share(id = receiptId, cookie = ana): Promise<ClaimLink> {
  const res = await api(linkPath(id), { cookie, body: {} });
  expect([200, 201]).toContain(res.status);
  return ClaimLinkSchema.parse(await res.json());
}

const guestClaim = async (token: string, participantId: string, items: unknown[]) =>
  await api(`/api/claim-links/${token}/claims`, { method: "PUT", body: { participantId, items } });

const claimsFrom = async (res: Response): Promise<ReceiptClaim[]> => {
  expect(res.status).toBe(200);
  return ReceiptClaimsResponseSchema.parse(await res.json()).claims;
};

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
  anaId = group.myParticipantId;
  const invite = InviteSchema.parse(
    await (await api(`/api/groups/${groupId}/invites`, { cookie: ana, body: {} })).json(),
  );
  AcceptInviteResponseSchema.parse(
    await (await api(`/api/invites/${invite.code}/accept`, { cookie: bo, body: {} })).json(),
  );
  rahulId = ParticipantSchema.parse(
    await (
      await api(`/api/groups/${groupId}/participants`, {
        cookie: ana,
        body: { displayName: "Rahul" },
      })
    ).json(),
  ).id;
  receiptId = await readyReceipt();
});

afterAll(async () => {
  await ctx?.stop();
});

describe("sharing a claim link", () => {
  it("creates one link per receipt and returns the same one when asked again", async () => {
    const first = await api(linkPath(), { cookie: ana, body: {} });
    expect(first.status).toBe(201);
    const link = ClaimLinkSchema.parse(await first.json());
    expect(link.url).toBe(`http://localhost:3000/claim/${link.token}`);
    expect(Buffer.from(link.token, "base64url")).toHaveLength(16);
    const hours = (Date.parse(link.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47);
    expect(hours).toBeLessThanOrEqual(48);

    const again = await api(linkPath(), { cookie: bo, body: { expiresInHours: 1 } });
    expect(again.status).toBe(200);
    expect(ClaimLinkSchema.parse(await again.json()).token).toBe(link.token);

    const read = await api(linkPath(), { cookie: bo });
    expect(ClaimLinkResponseSchema.parse(await read.json()).link?.token).toBe(link.token);
  });

  it("is for members only, and only once the receipt has been read", async () => {
    expect((await api(linkPath(), { cookie: outsider, body: {} })).status).toBe(404);
    expect((await api(linkPath(), { cookie: outsider })).status).toBe(404);
    expect((await api(claimsPath(), { cookie: outsider })).status).toBe(404);
    expect((await api(linkPath(), { body: {} })).status).toBe(401);
    expect((await api(linkPath("nope"), { cookie: ana, body: {} })).status).toBe(404);
    expect((await api(linkPath(), { cookie: ana, body: { expiresInHours: 1000 } })).status).toBe(
      400,
    );

    const res = await api(`/api/groups/${groupId}/receipts`, {
      cookie: ana,
      body: { contentType: "image/jpeg", sizeBytes: 2048 },
    });
    const { receipt } = CreateReceiptResponseSchema.parse(await res.json());
    expect((await api(linkPath(receipt.id), { cookie: ana, body: {} })).status).toBe(409);
  });
});

describe("the guest page", () => {
  it("shows the receipt and names without a session, and nothing private", async () => {
    const link = await share();
    const res = await api(`/api/claim-links/${link.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const page = ClaimPageSchema.parse(JSON.parse(text));
    expect(page.groupName).toBe("Dinner club");
    expect(page.merchant).toBe("Corner Bistro");
    expect(page.items.map((i) => [i.index, i.description, i.totalPriceCents])).toEqual([
      [0, "Margherita", 1800],
      [1, "Tiramisu", 900],
      [2, "Sparkling water", 400],
    ]);
    expect(page.totalCents).toBe(3950);
    expect(page.people.map((p) => [p.displayName, p.hasAccount])).toEqual([
      ["Ana", true],
      ["Bo", true],
      ["Rahul", false],
    ]);
    expect(page.canAddGuest).toBe(true);
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("userId");
  });

  it("answers 404 for an unknown token", async () => {
    expect((await api("/api/claim-links/not-a-real-token")).status).toBe(404);
    expect((await guestClaim("not-a-real-token", rahulId, [])).status).toBe(404);
  });
});

describe("guests claiming", () => {
  it("lets a placeholder claim lines, replace them, and clear them", async () => {
    const { token } = await share();
    expect(
      await claimsFrom(await guestClaim(token, rahulId, [{ itemIndex: 0 }, { itemIndex: 2 }])),
    ).toEqual([
      { itemIndex: 0, participantId: rahulId, percent: null },
      { itemIndex: 2, participantId: rahulId, percent: null },
    ]);

    // Replaces, rather than adds to, what Rahul had.
    expect(
      await claimsFrom(await guestClaim(token, rahulId, [{ itemIndex: 1, percent: 10 }])),
    ).toEqual([{ itemIndex: 1, participantId: rahulId, percent: 10 }]);

    const page = ClaimPageSchema.parse(await (await api(`/api/claim-links/${token}`)).json());
    expect(page.claims).toEqual([{ itemIndex: 1, participantId: rahulId, percent: 10 }]);

    expect(await claimsFrom(await guestClaim(token, rahulId, []))).toEqual([]);
  });

  it("cannot claim as someone who has an account, or as someone outside the group", async () => {
    const { token } = await share();
    expect((await guestClaim(token, anaId, [{ itemIndex: 0 }])).status).toBe(403);
    expect(
      (await guestClaim(token, "00000000-0000-4000-8000-000000000000", [{ itemIndex: 0 }])).status,
    ).toBe(404);
  });

  it("rejects lines that do not exist and malformed claims", async () => {
    const { token } = await share();
    expect((await guestClaim(token, rahulId, [{ itemIndex: 3 }])).status).toBe(400);
    expect((await guestClaim(token, rahulId, [{ itemIndex: 0 }, { itemIndex: 0 }])).status).toBe(
      400,
    );
    expect((await guestClaim(token, rahulId, [{ itemIndex: 0, percent: 0 }])).status).toBe(400);
    expect((await guestClaim(token, rahulId, [{ itemIndex: 0, percent: 33.333 }])).status).toBe(
      400,
    );
    expect((await guestClaim(token, "nope", [{ itemIndex: 0 }])).status).toBe(400);
  });

  it("never lets a line be more than 100% claimed, even by simultaneous guests", async () => {
    const { token } = await share();
    const add = async (displayName: string) =>
      ClaimPersonSchema.parse(
        await (await api(`/api/claim-links/${token}/guests`, { body: { displayName } })).json(),
      ).id;
    const [cy, di] = [await add("Cy"), await add("Di")];

    expect((await guestClaim(token, rahulId, [{ itemIndex: 1, percent: 60 }])).status).toBe(200);
    expect((await guestClaim(token, cy, [{ itemIndex: 1, percent: 50 }])).status).toBe(409);
    expect((await guestClaim(token, cy, [{ itemIndex: 1, percent: 40 }])).status).toBe(200);
    // Raising your own share counts only other people's claims against the limit.
    expect((await guestClaim(token, rahulId, [{ itemIndex: 1, percent: 60 }])).status).toBe(200);
    expect((await guestClaim(token, rahulId, [{ itemIndex: 1, percent: 61 }])).status).toBe(409);

    await guestClaim(token, rahulId, []);
    await guestClaim(token, cy, []);
    const results = await Promise.all(
      [rahulId, cy, di].map((id) => guestClaim(token, id, [{ itemIndex: 0, percent: 50 }])),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 409]);
    const claims = await claimsFrom(await api(claimsPath(), { cookie: ana }));
    const onMargherita = claims.filter((c) => c.itemIndex === 0);
    expect(onMargherita.reduce((sum, c) => sum + (c.percent ?? 0), 0)).toBe(100);

    for (const id of [rahulId, cy, di]) await guestClaim(token, id, []);
  });
});

describe("guests adding themselves", () => {
  it("creates a placeholder, and returns the existing one for the same name", async () => {
    const { token } = await share();
    const created = await api(`/api/claim-links/${token}/guests`, {
      body: { displayName: "  Meera " },
    });
    expect(created.status).toBe(201);
    const meera = ClaimPersonSchema.parse(await created.json());
    expect(meera).toMatchObject({ displayName: "Meera", hasAccount: false });

    const again = await api(`/api/claim-links/${token}/guests`, { body: { displayName: "meera" } });
    expect(again.status).toBe(200);
    expect(ClaimPersonSchema.parse(await again.json()).id).toBe(meera.id);

    const existing = await api(`/api/claim-links/${token}/guests`, {
      body: { displayName: "rahul" },
    });
    expect(existing.status).toBe(200);
    expect(ClaimPersonSchema.parse(await existing.json()).id).toBe(rahulId);

    // The host sees her as an ordinary placeholder in the group.
    const group = GroupDetailSchema.parse(
      await (await api(`/api/groups/${groupId}`, { cookie: ana })).json(),
    );
    expect(group.participants.find((p) => p.id === meera.id)?.isPlaceholder).toBe(true);
  });

  it("will not hand out a member's name, and validates the name", async () => {
    const { token } = await share();
    expect(
      (await api(`/api/claim-links/${token}/guests`, { body: { displayName: "ana" } })).status,
    ).toBe(409);
    expect(
      (await api(`/api/claim-links/${token}/guests`, { body: { displayName: " " } })).status,
    ).toBe(400);
  });

  it("stops adding people once the link has used its quota", async () => {
    const other = await readyReceipt();
    const { token, id } = await share(other);
    await ctx.db.db
      .update(schema.claimLinks)
      .set({ guestsAdded: CLAIM_LINK_MAX_GUESTS - 1 })
      .where(eq(schema.claimLinks.id, id));

    const last = await api(`/api/claim-links/${token}/guests`, { body: { displayName: "Last" } });
    expect(last.status).toBe(201);
    const over = await api(`/api/claim-links/${token}/guests`, { body: { displayName: "Extra" } });
    expect(over.status).toBe(409);
    // Existing names still resolve, so people already added can keep claiming.
    expect(
      (await api(`/api/claim-links/${token}/guests`, { body: { displayName: "Last" } })).status,
    ).toBe(200);
    const page = ClaimPageSchema.parse(await (await api(`/api/claim-links/${token}`)).json());
    expect(page.canAddGuest).toBe(false);
  });
});

describe("members claiming", () => {
  it("lets any member set claims for anyone in the group, including themselves", async () => {
    const mine = await api(claimsPath(), {
      method: "PUT",
      cookie: ana,
      body: { participantId: anaId, items: [{ itemIndex: 2 }] },
    });
    expect(await claimsFrom(mine)).toContainEqual({
      itemIndex: 2,
      participantId: anaId,
      percent: null,
    });
    const forRahul = await api(claimsPath(), {
      method: "PUT",
      cookie: bo,
      body: { participantId: rahulId, items: [{ itemIndex: 2, percent: 25 }] },
    });
    expect(await claimsFrom(forRahul)).toContainEqual({
      itemIndex: 2,
      participantId: rahulId,
      percent: 25,
    });

    const other = await api(claimsPath(), {
      method: "PUT",
      cookie: ana,
      body: { participantId: "00000000-0000-4000-8000-000000000000", items: [] },
    });
    expect(other.status).toBe(404);
    expect(
      (
        await api(claimsPath(), {
          method: "PUT",
          cookie: outsider,
          body: { participantId: rahulId, items: [] },
        })
      ).status,
    ).toBe(404);
  });
});

describe("links that stop working", () => {
  it("revoking turns the link off, keeps the claims, and a new link gets a new token", async () => {
    const id = await readyReceipt();
    const { token } = await share(id);
    expect((await guestClaim(token, rahulId, [{ itemIndex: 0 }])).status).toBe(200);

    expect((await api(linkPath(id), { method: "DELETE", cookie: bo })).status).toBe(204);
    expect((await api(`/api/claim-links/${token}`)).status).toBe(410);
    expect((await guestClaim(token, rahulId, [])).status).toBe(410);
    expect(
      (await api(`/api/claim-links/${token}/guests`, { body: { displayName: "Zed" } })).status,
    ).toBe(410);
    const read = await api(linkPath(id), { cookie: ana });
    expect(ClaimLinkResponseSchema.parse(await read.json()).link).toBeNull();

    expect(await claimsFrom(await api(claimsPath(id), { cookie: ana }))).toEqual([
      { itemIndex: 0, participantId: rahulId, percent: null },
    ]);

    const fresh = await share(id);
    expect(fresh.token).not.toBe(token);
    expect((await api(`/api/claim-links/${fresh.token}`)).status).toBe(200);
  });

  it("an expired link answers 410 and is replaced by the next share", async () => {
    const id = await readyReceipt();
    const link = await share(id);
    await ctx.db.db
      .update(schema.claimLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.claimLinks.id, link.id));
    expect((await api(`/api/claim-links/${link.token}`)).status).toBe(410);
    expect((await guestClaim(link.token, rahulId, [{ itemIndex: 0 }])).status).toBe(410);
    expect((await share(id)).token).not.toBe(link.token);
  });

  it("deleting the group makes its links unknown", async () => {
    const solo = GroupDetailSchema.parse(
      await (await api("/api/groups", { cookie: outsider, body: { name: "Solo" } })).json(),
    );
    const id = await readyReceipt(solo.id, outsider);
    const res = await api(`/api/groups/${solo.id}/receipts/${id}/claim-link`, {
      cookie: outsider,
      body: {},
    });
    const { token } = ClaimLinkSchema.parse(await res.json());
    expect((await api(`/api/claim-links/${token}`)).status).toBe(200);
    expect(
      (await api(`/api/groups/${solo.id}`, { method: "DELETE", cookie: outsider })).status,
    ).toBeLessThan(300);
    expect((await api(`/api/claim-links/${token}`)).status).toBe(404);
  });
});

describe("editing the receipt", () => {
  it("keeps claims when the lines are untouched and clears them when lines change", async () => {
    const id = await readyReceipt();
    const { token } = await share(id);
    await guestClaim(token, rahulId, [{ itemIndex: 0 }, { itemIndex: 1 }]);
    const patch = (body: unknown) =>
      api(`/api/groups/${groupId}/receipts/${id}`, { method: "PATCH", cookie: ana, body });

    expect((await patch({ ...EXTRACTION, merchant: "The Corner Bistro" })).status).toBe(200);
    expect(await claimsFrom(await api(claimsPath(id), { cookie: ana }))).toHaveLength(2);

    const fewer = { ...EXTRACTION, items: EXTRACTION.items.slice(0, 2), totalCents: 3550 };
    expect((await patch(fewer)).status).toBe(200);
    expect(await claimsFrom(await api(claimsPath(id), { cookie: ana }))).toEqual([]);
    // The link itself still works for claiming against the corrected lines.
    expect((await guestClaim(token, rahulId, [{ itemIndex: 2 }])).status).toBe(400);
    expect((await guestClaim(token, rahulId, [{ itemIndex: 1 }])).status).toBe(200);
  });
});
