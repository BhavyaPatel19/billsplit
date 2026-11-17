import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";

/**
 * Which emails a person gets. A row is created the first time it is needed; until then the
 * defaults apply (everything on). The unsubscribe token goes in every email's footer and
 * List-Unsubscribe header, so turning email off never needs a sign-in.
 */
export const notificationPrefs = pgTable("notification_prefs", {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** "Bo added Dinner and your share is $15" and "Bo recorded your payment". */
  activityEmails: boolean().notNull().default(true),
  /** Weekly "you owe" summary. */
  reminderEmails: boolean().notNull().default(true),
  unsubscribeToken: text().notNull().unique(),
  lastReminderAt: timestamp({ withTimezone: true }),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
