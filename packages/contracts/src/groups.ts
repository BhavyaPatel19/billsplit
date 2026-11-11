import { z } from "zod";

export const CurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code like USD")
  .describe("ISO 4217 currency code");

export const ParticipantRoleSchema = z.enum(["owner", "member"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const ParticipantSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  /** Null for a placeholder (no account yet). */
  userId: z.string().nullable(),
  role: ParticipantRoleSchema,
  isPlaceholder: z.boolean(),
  /** True for the participant row that belongs to the requesting user. */
  isMe: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const GroupSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  currency: CurrencySchema,
  memberCount: z.number().int().nonnegative(),
  myParticipantId: z.uuid(),
  myRole: ParticipantRoleSchema,
  createdAt: z.iso.datetime(),
});
export type GroupSummary = z.infer<typeof GroupSummarySchema>;

export const GroupDetailSchema = GroupSummarySchema.extend({
  participants: z.array(ParticipantSchema),
});
export type GroupDetail = z.infer<typeof GroupDetailSchema>;

export const GroupListResponseSchema = z.object({ groups: z.array(GroupSummarySchema) });
export type GroupListResponse = z.infer<typeof GroupListResponseSchema>;

export const CreateGroupBodySchema = z.object({
  name: z.string().trim().min(1, "Give the group a name").max(80),
  currency: CurrencySchema.default("USD"),
});
export type CreateGroupBody = z.infer<typeof CreateGroupBodySchema>;

export const UpdateGroupBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    currency: CurrencySchema,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");
export type UpdateGroupBody = z.infer<typeof UpdateGroupBodySchema>;

export const CreateParticipantBodySchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name").max(80),
});
export type CreateParticipantBody = z.infer<typeof CreateParticipantBodySchema>;

export const UpdateParticipantBodySchema = CreateParticipantBodySchema;

export const MergeParticipantBodySchema = z.object({
  /** The participant (with an account) that absorbs the placeholder's history. */
  intoParticipantId: z.uuid(),
});
export type MergeParticipantBody = z.infer<typeof MergeParticipantBodySchema>;

export const InviteSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  /** Absolute join URL to share. */
  url: z.url(),
  expiresAt: z.iso.datetime(),
  maxUses: z.number().int().positive().nullable(),
  uses: z.number().int().nonnegative(),
  /** When set, whoever accepts this invite claims that placeholder. */
  participantId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const CreateInviteBodySchema = z.object({
  expiresInDays: z.number().int().min(1).max(30).default(7),
  maxUses: z.number().int().min(1).max(100).optional(),
  participantId: z.uuid().optional(),
});
export type CreateInviteBody = z.infer<typeof CreateInviteBodySchema>;

export const InviteListResponseSchema = z.object({ invites: z.array(InviteSchema) });

export const InviteStatusSchema = z.enum(["valid", "expired", "revoked", "exhausted", "claimed"]);
export type InviteStatus = z.infer<typeof InviteStatusSchema>;

/** What a visitor sees on the join page before accepting. */
export const InvitePreviewSchema = z.object({
  groupName: z.string(),
  memberCount: z.number().int().nonnegative(),
  /** Name of the placeholder this invite claims, if any. */
  placeholderName: z.string().nullable(),
  status: InviteStatusSchema,
});
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

export const AcceptInviteResponseSchema = z.object({
  groupId: z.uuid(),
  participantId: z.uuid(),
  /** True when the user was already in the group; nothing changed. */
  alreadyMember: z.boolean(),
});
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
