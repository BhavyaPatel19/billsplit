import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { groups, participants } from "./groups.js";
import { receipts } from "./receipts.js";

/**
 * A link the host shares so friends can tap what they had on a receipt without an account:
 * /claim/<token> on the web. The token is the only credential, so it is long and random, it
 * expires, and it can be revoked.
 */
export const claimLinks = pgTable(
  "claim_links",
  {
    id: uuid().primaryKey().defaultRandom(),
    receiptId: uuid()
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** URL-safe random token (128 bits). */
    token: text().notNull().unique(),
    createdBy: uuid().references(() => participants.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    /** Placeholders created through this link, capped so a leaked link cannot flood a group. */
    guestsAdded: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("claim_links_receipt_id_idx").on(t.receiptId)],
);

/**
 * "This person had this line." `itemIndex` points into the receipt's reviewed OCR items, so
 * claims are cleared whenever those items are edited. A null `percentBp` means an equal share
 * of whatever the percent claims leave over; a value is a fixed share in basis points
 * (1000 = 10%, "just a bite").
 */
export const receiptClaims = pgTable(
  "receipt_claims",
  {
    id: uuid().primaryKey().defaultRandom(),
    receiptId: uuid()
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    itemIndex: integer().notNull(),
    participantId: uuid()
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    percentBp: integer(),
    /** Set when a guest made the claim through a link; null when a member did. */
    claimLinkId: uuid().references(() => claimLinks.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("receipt_claims_item_participant_uq").on(t.receiptId, t.itemIndex, t.participantId),
    index("receipt_claims_participant_id_idx").on(t.participantId),
    check("receipt_claims_item_index_nonnegative", sql`${t.itemIndex} >= 0`),
    check(
      "receipt_claims_percent_range",
      sql`${t.percentBp} is null or (${t.percentBp} between 1 and 10000)`,
    ),
  ],
);
