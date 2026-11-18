import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { expenses } from "./expenses.js";
import { groups, participants } from "./groups.js";
import { receipts } from "./receipts.js";

const cents = () => bigint({ mode: "number" });

export const pantryRunStatus = pgEnum("pantry_run_status", ["open", "settled"]);

/**
 * A bulk shop whose items are shared stock ("the Costco run"). People mark what they used over
 * the following days; settling posts one expense split by those uses.
 */
export const pantryRuns = pgTable(
  "pantry_runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    receiptId: uuid().references(() => receipts.id, { onDelete: "set null" }),
    description: text().notNull(),
    payerId: uuid()
      .notNull()
      .references(() => participants.id),
    boughtOn: date({ mode: "string" }).notNull(),
    currency: char({ length: 3 }).notNull(),
    taxCents: cents().notNull().default(0),
    feeCents: cents().notNull().default(0),
    discountCents: cents().notNull().default(0),
    status: pantryRunStatus().notNull().default("open"),
    expenseId: uuid().references(() => expenses.id, { onDelete: "set null" }),
    createdBy: uuid().references(() => participants.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("pantry_runs_group_id_idx").on(t.groupId),
    check(
      "pantry_runs_extras_nonnegative",
      sql`${t.taxCents} >= 0 and ${t.feeCents} >= 0 and ${t.discountCents} >= 0`,
    ),
  ],
);

export const pantryItems = pgTable(
  "pantry_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => pantryRuns.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    name: text().notNull(),
    amountCents: cents().notNull(),
  },
  (t) => [
    index("pantry_items_run_id_idx").on(t.runId),
    check("pantry_items_amount_nonnegative", sql`${t.amountCents} >= 0`),
  ],
);

/** How much of an item someone used, in units ("2" for two of the six cartons). */
export const pantryUses = pgTable(
  "pantry_uses",
  {
    itemId: uuid()
      .notNull()
      .references(() => pantryItems.id, { onDelete: "cascade" }),
    participantId: uuid()
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    units: integer().notNull(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.participantId] }),
    check("pantry_uses_units_positive", sql`${t.units} > 0`),
  ],
);
