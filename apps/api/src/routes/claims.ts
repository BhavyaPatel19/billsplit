import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute, resolver } from "hono-openapi";
import type { z } from "zod";
import { schema, type Db } from "@billsplit/db";
import {
  AddGuestBodySchema,
  CLAIM_LINK_MAX_GUESTS,
  ClaimLinkResponseSchema,
  ClaimLinkSchema,
  ClaimPageSchema,
  ClaimPersonSchema,
  CreateClaimLinkBodySchema,
  ReceiptClaimsResponseSchema,
  ReceiptOcrSchema,
  SetClaimsBodySchema,
  type ClaimLink,
  type ClaimPage,
  type ClaimPerson,
  type ReceiptClaim,
  type ReceiptOcr,
  type SetClaimsBody,
} from "@billsplit/contracts";
import type { Env } from "../env.js";
import type { ClaimEvents } from "../lib/claim-events.js";
import { requireMembership } from "../lib/authorize.js";
import { badRequest, conflict, forbidden, gone, notFound } from "../lib/errors.js";
import { isUuid } from "../lib/ids.js";
import { validate } from "../lib/validate.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";

type LinkRow = typeof schema.claimLinks.$inferSelect;
type ReceiptRow = typeof schema.receipts.$inferSelect;
type ClaimRow = typeof schema.receiptClaims.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const FULL_BP = 10_000;
const KEEP_ALIVE_MS = 25_000;
const json = (s: z.ZodType) => ({ "application/json": { schema: resolver(s) } });

const toClaim = (c: ClaimRow): ReceiptClaim => ({
  itemIndex: c.itemIndex,
  participantId: c.participantId,
  percent: c.percentBp === null ? null : c.percentBp / 100,
});

/** The reviewed lines, or null while the receipt is still uploading, processing or failed. */
function reviewedOcr(receipt: ReceiptRow): ReceiptOcr | null {
  if ((receipt.status !== "ready" && receipt.status !== "needs_review") || !receipt.ocr) {
    return null;
  }
  return ReceiptOcrSchema.parse(receipt.ocr);
}

/**
 * Replace everything one participant has claimed on a receipt. The receipt row is locked for
 * the transaction so two people claiming the same line at once cannot push it past 100%.
 */
async function replaceClaims(
  tx: Tx,
  receiptId: string,
  body: SetClaimsBody,
  claimLinkId: string | null,
): Promise<void> {
  const [receipt] = await tx
    .select()
    .from(schema.receipts)
    .where(eq(schema.receipts.id, receiptId))
    .for("update");
  const ocr = receipt ? reviewedOcr(receipt) : null;
  if (!ocr) throw conflict("This receipt is not ready to be claimed");

  const outOfRange = body.items.find((i) => i.itemIndex >= ocr.items.length);
  if (outOfRange) throw badRequest(`There is no line ${outOfRange.itemIndex} on this receipt`);

  const withPercent = body.items.filter((i) => i.percent != null);
  if (withPercent.length > 0) {
    const others = await tx
      .select({
        itemIndex: schema.receiptClaims.itemIndex,
        bp: sql<number>`coalesce(sum(${schema.receiptClaims.percentBp}), 0)::int`,
      })
      .from(schema.receiptClaims)
      .where(
        and(
          eq(schema.receiptClaims.receiptId, receiptId),
          ne(schema.receiptClaims.participantId, body.participantId),
          inArray(
            schema.receiptClaims.itemIndex,
            withPercent.map((i) => i.itemIndex),
          ),
        ),
      )
      .groupBy(schema.receiptClaims.itemIndex);
    const taken = new Map(others.map((o) => [o.itemIndex, o.bp]));
    for (const item of withPercent) {
      const bp = Math.round(item.percent! * 100);
      if ((taken.get(item.itemIndex) ?? 0) + bp > FULL_BP) {
        const name = ocr.items[item.itemIndex]!.description;
        throw conflict(`More than 100% of "${name}" would be claimed`);
      }
    }
  }

  await tx
    .delete(schema.receiptClaims)
    .where(
      and(
        eq(schema.receiptClaims.receiptId, receiptId),
        eq(schema.receiptClaims.participantId, body.participantId),
      ),
    );
  if (body.items.length > 0) {
    await tx.insert(schema.receiptClaims).values(
      body.items.map((i) => ({
        receiptId,
        itemIndex: i.itemIndex,
        participantId: body.participantId,
        percentBp: i.percent == null ? null : Math.round(i.percent * 100),
        claimLinkId,
      })),
    );
  }
}

/**
 * Claim links: the host shares /claim/<token>, and each friend taps what they had without an
 * account. Guests act only as placeholders, which merge into a real account later.
 */
export function claimRoutes(db: Db, env: Pick<Env, "APP_URL">, events: ClaimEvents) {
  const router = new Hono<{ Variables: SessionVariables }>();

  const toLink = (l: LinkRow): ClaimLink => ({
    id: l.id,
    receiptId: l.receiptId,
    token: l.token,
    url: `${env.APP_URL}/claim/${l.token}`,
    expiresAt: l.expiresAt.toISOString(),
    createdAt: l.createdAt.toISOString(),
  });

  const claimsOf = async (receiptId: string): Promise<ReceiptClaim[]> => {
    const rows = await db
      .select()
      .from(schema.receiptClaims)
      .where(eq(schema.receiptClaims.receiptId, receiptId))
      .orderBy(schema.receiptClaims.itemIndex, schema.receiptClaims.createdAt);
    return rows.map(toClaim);
  };

  const activePeople = async (groupId: string) =>
    await db
      .select()
      .from(schema.participants)
      .where(
        and(eq(schema.participants.groupId, groupId), isNull(schema.participants.mergedIntoId)),
      )
      .orderBy(schema.participants.createdAt);

  const activeLink = async (receiptId: string, runner: Db | Tx = db) => {
    const [row] = await runner
      .select()
      .from(schema.claimLinks)
      .where(
        and(
          eq(schema.claimLinks.receiptId, receiptId),
          isNull(schema.claimLinks.revokedAt),
          gt(schema.claimLinks.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row ?? null;
  };

  /* ---------------------------------------------------------------- members */

  /** Membership plus the receipt, if it belongs to the group. Non-members get a 404. */
  const memberReceipt = async (userId: string, groupId: string, receiptId: string) => {
    const membership = await requireMembership(db, userId, groupId);
    if (!isUuid(receiptId)) throw notFound("Receipt not found");
    const [receipt] = await db
      .select()
      .from(schema.receipts)
      .where(and(eq(schema.receipts.id, receiptId), eq(schema.receipts.groupId, groupId)))
      .limit(1);
    if (!receipt) throw notFound("Receipt not found");
    return { ...membership, receipt };
  };

  router.use("/groups/:id/receipts/:receiptId/claim-link", requireSession);
  router.use("/groups/:id/receipts/:receiptId/claims", requireSession);
  router.use("/groups/:id/receipts/:receiptId/claims/stream", requireSession);
  // A compressing proxy (Next.js rewrites in development, for one) buffers a stream until it
  // has enough to compress, so events would never arrive. `no-transform` tells it to pass the
  // bytes through; X-Accel-Buffering does the same for nginx-style proxies. Set after the
  // handler because the SSE helper writes its own Cache-Control.
  router.use("/groups/:id/receipts/:receiptId/claims/stream", async (c, next) => {
    await next();
    if (c.res.headers.get("content-type")?.startsWith("text/event-stream")) {
      c.res.headers.set("Cache-Control", "no-store, no-transform");
      c.res.headers.set("X-Accel-Buffering", "no");
    }
  });

  router.post(
    "/groups/:id/receipts/:receiptId/claim-link",
    describeRoute({
      tags: ["claims"],
      summary: "Create the receipt's claim link, or return the one already active",
      responses: {
        200: { description: "A link was already active", content: json(ClaimLinkSchema) },
        201: { description: "Created", content: json(ClaimLinkSchema) },
        409: { description: "The receipt has not finished processing" },
      },
    }),
    validate("json", CreateClaimLinkBodySchema),
    async (c) => {
      const { me, receipt } = await memberReceipt(
        c.get("session")!.user.id,
        c.req.param("id"),
        c.req.param("receiptId"),
      );
      if (!reviewedOcr(receipt)) throw conflict("Wait until the receipt has been read");
      const { expiresInHours } = c.req.valid("json");

      const result = await db.transaction(async (tx) => {
        // Serialise on the receipt so two taps on "Share" produce one link.
        await tx
          .select({ id: schema.receipts.id })
          .from(schema.receipts)
          .where(eq(schema.receipts.id, receipt.id))
          .for("update");
        const existing = await activeLink(receipt.id, tx);
        if (existing) return { link: existing, created: false };
        const [link] = await tx
          .insert(schema.claimLinks)
          .values({
            receiptId: receipt.id,
            groupId: receipt.groupId,
            token: randomBytes(16).toString("base64url"),
            createdBy: me.id,
            expiresAt: new Date(Date.now() + expiresInHours * 3_600_000),
          })
          .returning();
        return { link: link!, created: true };
      });
      return c.json(toLink(result.link), result.created ? 201 : 200);
    },
  );

  router.get(
    "/groups/:id/receipts/:receiptId/claim-link",
    describeRoute({
      tags: ["claims"],
      summary: "The receipt's active claim link, if any",
      responses: { 200: { description: "OK", content: json(ClaimLinkResponseSchema) } },
    }),
    async (c) => {
      const { receipt } = await memberReceipt(
        c.get("session")!.user.id,
        c.req.param("id"),
        c.req.param("receiptId"),
      );
      const link = await activeLink(receipt.id);
      return c.json({ link: link ? toLink(link) : null }, 200);
    },
  );

  router.delete(
    "/groups/:id/receipts/:receiptId/claim-link",
    describeRoute({
      tags: ["claims"],
      summary: "Revoke the receipt's claim link; claims already made are kept",
      responses: { 204: { description: "Revoked (or there was none)" } },
    }),
    async (c) => {
      const { receipt } = await memberReceipt(
        c.get("session")!.user.id,
        c.req.param("id"),
        c.req.param("receiptId"),
      );
      await db
        .update(schema.claimLinks)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(schema.claimLinks.receiptId, receipt.id), isNull(schema.claimLinks.revokedAt)),
        );
      return c.body(null, 204);
    },
  );

  router.get(
    "/groups/:id/receipts/:receiptId/claims",
    describeRoute({
      tags: ["claims"],
      summary: "Who has claimed which lines of a receipt",
      responses: { 200: { description: "OK", content: json(ReceiptClaimsResponseSchema) } },
    }),
    async (c) => {
      const { receipt } = await memberReceipt(
        c.get("session")!.user.id,
        c.req.param("id"),
        c.req.param("receiptId"),
      );
      return c.json({ claims: await claimsOf(receipt.id) }, 200);
    },
  );

  router.put(
    "/groups/:id/receipts/:receiptId/claims",
    describeRoute({
      tags: ["claims"],
      summary: "Set what one person had (any member can do this for anyone in the group)",
      responses: {
        200: { description: "OK", content: json(ReceiptClaimsResponseSchema) },
        409: { description: "Receipt not ready, or a line would be over 100% claimed" },
      },
    }),
    validate("json", SetClaimsBodySchema),
    async (c) => {
      const { group, receipt } = await memberReceipt(
        c.get("session")!.user.id,
        c.req.param("id"),
        c.req.param("receiptId"),
      );
      const body = c.req.valid("json");
      const people = await activePeople(group.id);
      if (!people.some((p) => p.id === body.participantId)) {
        throw notFound("Participant not found");
      }
      await db.transaction((tx) => replaceClaims(tx, receipt.id, body, null));
      events.publish(receipt.id);
      return c.json({ claims: await claimsOf(receipt.id) }, 200);
    },
  );

  router.get(
    "/groups/:id/receipts/:receiptId/claims/stream",
    describeRoute({
      tags: ["claims"],
      summary: "Live claims for a receipt (server-sent events)",
      description:
        "Sends a `claims` event with the full list straight away and again after every change, " +
        "plus a comment every 25 seconds to keep proxies from closing the connection.",
      responses: { 200: { description: "text/event-stream of `claims` events" } },
    }),
    async (c) => {
      const { receipt } = await memberReceipt(
        c.get("session")!.user.id,
        c.req.param("id"),
        c.req.param("receiptId"),
      );
      return streamSSE(c, async (stream) => {
        let changed = true;
        let wake = (): void => undefined;
        const unsubscribe = events.subscribe(receipt.id, () => {
          changed = true;
          wake();
        });
        stream.onAbort(() => {
          unsubscribe();
          wake();
        });
        try {
          while (!stream.aborted && !stream.closed) {
            if (changed) {
              changed = false;
              await stream.writeSSE({
                event: "claims",
                data: JSON.stringify({ claims: await claimsOf(receipt.id) }),
              });
            } else {
              await stream.write(": keep-alive\n\n");
            }
            if (changed) continue;
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, KEEP_ALIVE_MS);
              wake = () => {
                clearTimeout(timer);
                resolve();
              };
            });
          }
        } finally {
          unsubscribe();
        }
      });
    },
  );

  /* ----------------------------------------------------------------- guests */

  /**
   * Resolve a token to its link and receipt. Unknown tokens are 404; a link that was revoked
   * or has expired is 410, so the guest page can say "ask for a new link".
   */
  const loadByToken = async (token: string) => {
    const [row] = await db
      .select({ link: schema.claimLinks, receipt: schema.receipts, group: schema.groups })
      .from(schema.claimLinks)
      .innerJoin(schema.receipts, eq(schema.receipts.id, schema.claimLinks.receiptId))
      .innerJoin(schema.groups, eq(schema.groups.id, schema.claimLinks.groupId))
      .where(and(eq(schema.claimLinks.token, token), isNull(schema.groups.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Claim link not found");
    if (row.link.revokedAt) throw gone("This claim link was turned off");
    if (row.link.expiresAt.getTime() <= Date.now()) throw gone("This claim link has expired");
    const ocr = reviewedOcr(row.receipt);
    if (!ocr) throw conflict("This receipt is not ready to be claimed");
    return { ...row, ocr };
  };

  const toPerson = (p: typeof schema.participants.$inferSelect): ClaimPerson => ({
    id: p.id,
    displayName: p.displayName,
    hasAccount: p.userId !== null,
  });

  router.get(
    "/claim-links/:token",
    describeRoute({
      tags: ["claims"],
      summary: "The receipt behind a claim link (no sign-in needed)",
      responses: {
        200: { description: "OK", content: json(ClaimPageSchema) },
        404: { description: "Unknown link" },
        410: { description: "Expired or revoked" },
      },
    }),
    async (c) => {
      const { link, receipt, group, ocr } = await loadByToken(c.req.param("token"));
      const [people, claims] = await Promise.all([activePeople(group.id), claimsOf(receipt.id)]);
      const body: ClaimPage = {
        groupName: group.name,
        merchant: ocr.merchant,
        date: ocr.date,
        currency: ocr.currency ?? group.currency,
        items: ocr.items.map((item, index) => ({
          index,
          description: item.description,
          quantity: item.quantity,
          totalPriceCents: item.totalPriceCents,
        })),
        taxCents: ocr.taxCents,
        tipCents: ocr.tipCents,
        feeCents: ocr.feeCents,
        discountCents: ocr.discountCents,
        totalCents: ocr.totalCents,
        people: people.map(toPerson),
        claims,
        canAddGuest: link.guestsAdded < CLAIM_LINK_MAX_GUESTS,
        expiresAt: link.expiresAt.toISOString(),
      };
      c.header("Cache-Control", "no-store");
      return c.json(body, 200);
    },
  );

  router.post(
    "/claim-links/:token/guests",
    describeRoute({
      tags: ["claims"],
      summary: "Add yourself to the group as a placeholder (no sign-in needed)",
      description:
        "Returns the existing placeholder when one already has that name, so reloading the " +
        "page or a second device does not create duplicates.",
      responses: {
        200: {
          description: "A placeholder with that name already existed",
          content: json(ClaimPersonSchema),
        },
        201: { description: "Created", content: json(ClaimPersonSchema) },
        409: { description: "The name belongs to a member, or the link's quota is used up" },
      },
    }),
    validate("json", AddGuestBodySchema),
    async (c) => {
      const { link, group } = await loadByToken(c.req.param("token"));
      const { displayName } = c.req.valid("json");

      const result = await db.transaction(async (tx) => {
        // Lock the link so concurrent guests cannot exceed the quota or duplicate a name.
        const [locked] = await tx
          .select()
          .from(schema.claimLinks)
          .where(eq(schema.claimLinks.id, link.id))
          .for("update");
        const [sameName] = await tx
          .select()
          .from(schema.participants)
          .where(
            and(
              eq(schema.participants.groupId, group.id),
              isNull(schema.participants.mergedIntoId),
              sql`lower(${schema.participants.displayName}) = lower(${displayName})`,
            ),
          )
          .limit(1);
        if (sameName) {
          if (sameName.userId !== null) {
            throw conflict(
              `${sameName.displayName} is a member; they claim from their own account`,
            );
          }
          return { person: sameName, created: false };
        }
        if (locked!.guestsAdded >= CLAIM_LINK_MAX_GUESTS) {
          throw conflict("This link cannot add more people; ask the host to add you");
        }
        const [person] = await tx
          .insert(schema.participants)
          .values({ groupId: group.id, displayName, role: "member" })
          .returning();
        await tx
          .update(schema.claimLinks)
          .set({ guestsAdded: sql`${schema.claimLinks.guestsAdded} + 1` })
          .where(eq(schema.claimLinks.id, link.id));
        return { person: person!, created: true };
      });
      return c.json(toPerson(result.person), result.created ? 201 : 200);
    },
  );

  router.put(
    "/claim-links/:token/claims",
    describeRoute({
      tags: ["claims"],
      summary: "Set what one placeholder had (no sign-in needed)",
      responses: {
        200: { description: "OK", content: json(ReceiptClaimsResponseSchema) },
        403: { description: "That person has an account and claims from inside the app" },
        409: { description: "A line would be over 100% claimed" },
      },
    }),
    validate("json", SetClaimsBodySchema),
    async (c) => {
      const { link, receipt, group } = await loadByToken(c.req.param("token"));
      const body = c.req.valid("json");
      const person = (await activePeople(group.id)).find((p) => p.id === body.participantId);
      if (!person) throw notFound("Participant not found");
      if (person.userId !== null) {
        throw forbidden(`${person.displayName} has an account and claims from inside the app`);
      }
      await db.transaction((tx) => replaceClaims(tx, receipt.id, body, link.id));
      events.publish(receipt.id);
      return c.json({ claims: await claimsOf(receipt.id) }, 200);
    },
  );

  return router;
}
