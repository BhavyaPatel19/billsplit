import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const MeResponseSchema = z.object({
  user: UserSchema,
  session: z.object({ expiresAt: z.iso.datetime() }),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const NotificationPrefsSchema = z.object({
  /** Emails when someone adds or edits an expense you are on, or records a payment with you. */
  activityEmails: z.boolean(),
  /** A weekly summary while you owe money in a group. */
  reminderEmails: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const UpdateNotificationPrefsBodySchema = NotificationPrefsSchema.partial().refine(
  (b) => Object.keys(b).length > 0,
  "Nothing to update",
);
export type UpdateNotificationPrefsBody = z.infer<typeof UpdateNotificationPrefsBodySchema>;

/** What the unsubscribe page shows before and after the click; no sign-in needed. */
export const UnsubscribeStatusSchema = z.object({
  /** Partly hidden, e.g. "an•••@example.com", so a forwarded link reveals little. */
  email: z.string(),
  prefs: NotificationPrefsSchema,
});
export type UnsubscribeStatus = z.infer<typeof UnsubscribeStatusSchema>;
