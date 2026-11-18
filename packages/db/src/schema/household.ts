import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups.js";

/**
 * Household details for someone in a group: how much of the rent their room carries and when
 * they lived there. A missing row means weight 1, there the whole time. Household bills copy
 * these into the expense when it is created, so editing them never rewrites history.
 */
export const householdResidents = pgTable(
  "household_residents",
  {
    participantId: uuid()
      .primaryKey()
      .references(() => participants.id, { onDelete: "cascade" }),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** Square feet, or a relative number such as 1.2. */
    roomWeight: doublePrecision().notNull().default(1),
    movedInOn: date({ mode: "string" }),
    movedOutOn: date({ mode: "string" }),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("household_residents_group_id_idx").on(t.groupId),
    check("household_residents_weight_nonnegative", sql`${t.roomWeight} >= 0`),
    check(
      "household_residents_out_after_in",
      sql`${t.movedInOn} is null or ${t.movedOutOn} is null or ${t.movedOutOn} >= ${t.movedInOn}`,
    ),
  ],
);

/** Days someone was away (a trip); they come off usage-based bills such as utilities. */
export const awayPeriods = pgTable(
  "away_periods",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    participantId: uuid()
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    fromOn: date({ mode: "string" }).notNull(),
    toOn: date({ mode: "string" }).notNull(),
    note: text(),
    createdBy: uuid().references(() => participants.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("away_periods_group_participant_idx").on(t.groupId, t.participantId),
    check("away_periods_ordered", sql`${t.toOn} >= ${t.fromOn}`),
  ],
);
