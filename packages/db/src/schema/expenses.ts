import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups.js";

const createdAt = timestamp({ withTimezone: true }).notNull().defaultNow();
/** Money in minor units. JS numbers are exact up to 2^53, far above any bill. */
const cents = () => bigint({ mode: "number" });

/**
 * An expense is a stable identity; its content lives in immutable versions. Editing creates a
 * new version and moves `currentVersionId`, so history and "who changed what" are never lost.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    currentVersionId: uuid().references((): AnyPgColumn => expenseVersions.id, {
      onDelete: "set null",
    }),
    createdBy: uuid().references(() => participants.id, { onDelete: "set null" }),
    /** Client-supplied Idempotency-Key, so a retried POST never creates a duplicate. */
    idempotencyKey: text(),
    createdAt,
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("expenses_group_id_idx").on(t.groupId),
    uniqueIndex("expenses_group_idempotency_uidx")
      .on(t.groupId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const expenseVersions = pgTable(
  "expense_versions",
  {
    id: uuid().primaryKey().defaultRandom(),
    expenseId: uuid()
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    description: text().notNull(),
    currency: char({ length: 3 }).notNull(),
    spentOn: date({ mode: "string" }).notNull(),
    payerId: uuid()
      .notNull()
      .references(() => participants.id),
    totalCents: cents().notNull(),
    /** The validated request (items, splits, adjustments); the split engine recomputes from it. */
    input: jsonb().notNull(),
    createdBy: uuid().references(() => participants.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [unique("expense_versions_expense_version_uq").on(t.expenseId, t.version)],
);

/** Per-person result of a version: what they paid and what their share is. Drives balances. */
export const expenseShares = pgTable(
  "expense_shares",
  {
    versionId: uuid()
      .notNull()
      .references(() => expenseVersions.id, { onDelete: "cascade" }),
    participantId: uuid()
      .notNull()
      .references(() => participants.id),
    paidCents: cents().notNull(),
    owedCents: cents().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.participantId] }),
    index("expense_shares_participant_idx").on(t.participantId),
  ],
);

/** A recorded payment between two people in a group ("Bo paid Ana $5.14"). */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    fromId: uuid()
      .notNull()
      .references(() => participants.id),
    toId: uuid()
      .notNull()
      .references(() => participants.id),
    amountCents: cents().notNull(),
    currency: char({ length: 3 }).notNull(),
    note: text(),
    createdBy: uuid().references(() => participants.id, { onDelete: "set null" }),
    idempotencyKey: text(),
    createdAt,
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("settlements_group_id_idx").on(t.groupId),
    uniqueIndex("settlements_group_idempotency_uidx")
      .on(t.groupId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check("settlements_amount_positive", sql`${t.amountCents} > 0`),
    check("settlements_distinct_parties", sql`${t.fromId} <> ${t.toId}`),
  ],
);
