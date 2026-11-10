import { sql } from "drizzle-orm";
import {
  char,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";

const createdAt = timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp({ withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const participantRole = pgEnum("participant_role", ["owner", "member"]);

/** A circle of people who split bills: a trip, a flat, a dinner club. */
export const groups = pgTable(
  "groups",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    /** ISO 4217 default currency for new expenses. */
    currency: char({ length: 3 }).notNull().default("USD"),
    createdBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
    /** Soft delete; purged after 30 days by a worker job. */
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("groups_created_by_idx").on(t.createdBy)],
);

/**
 * Someone money is split with. Every expense, item share and ledger entry references a
 * participant, never a user directly, so people without an account ("placeholders") take part
 * in splits and can later be merged into a real account without rewriting history.
 */
export const participants = pgTable(
  "participants",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** Null for a placeholder. Set when a user joins or when a placeholder is merged. */
    userId: text().references(() => users.id, { onDelete: "set null" }),
    displayName: text().notNull(),
    role: participantRole().notNull().default("member"),
    /**
     * After a merge the placeholder row stays (its history still points here) and this links to
     * the surviving participant. Rows with a value are hidden from member lists.
     */
    mergedIntoId: uuid().references((): AnyPgColumn => participants.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("participants_group_id_idx").on(t.groupId),
    index("participants_user_id_idx").on(t.userId),
    // A user is at most one *active* participant per group; merged rows are exempt.
    uniqueIndex("participants_group_user_active_uidx")
      .on(t.groupId, t.userId)
      .where(sql`${t.userId} is not null and ${t.mergedIntoId} is null`),
  ],
);

/** Shareable join code / link for a group. */
export const invites = pgTable(
  "invites",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** URL-safe random token; the invite link is /join/<code>. */
    code: text().notNull().unique(),
    createdBy: uuid().references(() => participants.id, { onDelete: "set null" }),
    /** Optional: pre-link the invite to a placeholder so joining merges into it. */
    participantId: uuid().references(() => participants.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    maxUses: integer(),
    uses: integer().notNull().default(0),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt,
  },
  (t) => [index("invites_group_id_idx").on(t.groupId)],
);
