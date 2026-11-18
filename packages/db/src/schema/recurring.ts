import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups.js";

export const recurrenceFrequency = pgEnum("recurrence_frequency", ["weekly", "monthly"]);

/**
 * A bill that repeats (rent, Wi-Fi, utilities). The schedule is the source of truth: occurrence
 * `n` falls on a date computed from `startOn`, so a monthly bill on the 31st lands on the last
 * day of shorter months without drifting. Each posted occurrence is an ordinary expense that
 * points back here with its occurrence number, which a unique index keeps from posting twice.
 */
export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    createdBy: uuid().references(() => participants.id, { onDelete: "set null" }),
    /** The expense to post each time, as an expense request without `spentOn`. */
    template: jsonb().notNull(),
    frequency: recurrenceFrequency().notNull(),
    /** Every `interval` weeks or months. */
    interval: integer().notNull().default(1),
    startOn: date({ mode: "string" }).notNull(),
    /** Last day an occurrence may fall on; null repeats until deleted. */
    endOn: date({ mode: "string" }),
    /** Index of the next occurrence to post (0 is `startOn`). */
    nextOccurrence: integer().notNull().default(0),
    /** Date of `nextOccurrence`, kept in step with it so due schedules are one index scan. */
    nextOn: date({ mode: "string" }).notNull(),
    pausedAt: timestamp({ withTimezone: true }),
    /** Why the poster paused it (for example, someone on the bill left the group). */
    pausedReason: text(),
    lastPostedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("recurring_expenses_group_id_idx").on(t.groupId),
    index("recurring_expenses_due_idx")
      .on(t.nextOn)
      .where(sql`${t.deletedAt} is null and ${t.pausedAt} is null`),
    check("recurring_expenses_interval_range", sql`${t.interval} between 1 and 12`),
    check(
      "recurring_expenses_end_after_start",
      sql`${t.endOn} is null or ${t.endOn} >= ${t.startOn}`,
    ),
  ],
);
