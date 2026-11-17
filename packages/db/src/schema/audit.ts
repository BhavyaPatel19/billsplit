import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { groups, participants } from "./groups.js";

/**
 * Append-only record of changes to who is who in a group: a placeholder merged into an
 * account, or taken over through an invite. These rewrite whose history is whose, so the
 * owner can see who did it and when. Rows are never updated.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** Kept even if the actor later leaves the group. */
    actorUserId: text().references(() => users.id, { onDelete: "set null" }),
    actorParticipantId: uuid().references(() => participants.id, { onDelete: "set null" }),
    /** Dotted name, e.g. `participant.merged`. */
    action: text().notNull(),
    /** Names and ids as they were at the time, so the entry still reads after later changes. */
    details: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_group_created_idx").on(t.groupId, t.createdAt)],
);
