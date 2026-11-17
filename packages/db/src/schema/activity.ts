import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { groups, participants } from "./groups.js";

/**
 * What happened in a group, for the activity feed and (later) notification emails. Written in
 * the same transaction as the change. `involved` lists the participants the change touches
 * (who paid, who owes, who was paid), so a feed can say "involves you" and email can go to
 * exactly those people. Facts are copied into `data` so an entry still reads correctly after
 * the expense is edited or deleted.
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    actorParticipantId: uuid().references(() => participants.id, { onDelete: "set null" }),
    kind: text().notNull(),
    /** The expense, payment or participant the entry is about. */
    subjectId: uuid(),
    involved: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activities_group_created_idx").on(t.groupId, t.createdAt, t.id)],
);
