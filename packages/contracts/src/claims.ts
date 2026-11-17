import { z } from "zod";
import { CentsSchema } from "./expenses.js";
import { CreateParticipantBodySchema } from "./groups.js";

/** Placeholders one claim link may add, so a leaked link cannot flood a group. */
export const CLAIM_LINK_MAX_GUESTS = 20;

export const CreateClaimLinkBodySchema = z.object({
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(7 * 24)
    .default(48),
});
export type CreateClaimLinkBody = z.infer<typeof CreateClaimLinkBodySchema>;

export const ClaimLinkSchema = z.object({
  id: z.uuid(),
  receiptId: z.uuid(),
  token: z.string(),
  /** Absolute URL to share; opens without an account. */
  url: z.url(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type ClaimLink = z.infer<typeof ClaimLinkSchema>;

/** The receipt's active link, or null if none was created (or it expired or was revoked). */
export const ClaimLinkResponseSchema = z.object({ link: ClaimLinkSchema.nullable() });
export type ClaimLinkResponse = z.infer<typeof ClaimLinkResponseSchema>;

/**
 * A fixed share of a line, in percent with at most two decimals. Omitted or null means an
 * equal share of whatever the percent claims on that line leave over.
 */
const ClaimPercentSchema = z
  .number()
  .min(0.01)
  .max(100)
  .refine((p) => Math.abs(p * 100 - Math.round(p * 100)) < 1e-6, "Use at most two decimals");

export const ReceiptClaimSchema = z.object({
  /** Index into the receipt's reviewed items. */
  itemIndex: z.int().min(0),
  participantId: z.uuid(),
  percent: z.number().nullable(),
});
export type ReceiptClaim = z.infer<typeof ReceiptClaimSchema>;

export const ReceiptClaimsResponseSchema = z.object({ claims: z.array(ReceiptClaimSchema) });
export type ReceiptClaimsResponse = z.infer<typeof ReceiptClaimsResponseSchema>;

/** Replaces everything `participantId` has claimed on the receipt; an empty list clears it. */
export const SetClaimsBodySchema = z
  .object({
    participantId: z.uuid(),
    items: z
      .array(
        z.object({ itemIndex: z.int().min(0), percent: ClaimPercentSchema.nullable().optional() }),
      )
      .max(200),
  })
  .refine((b) => new Set(b.items.map((i) => i.itemIndex)).size === b.items.length, {
    path: ["items"],
    message: "Each line can be claimed once per person",
  });
export type SetClaimsBody = z.infer<typeof SetClaimsBodySchema>;

export const AddGuestBodySchema = CreateParticipantBodySchema;
export type AddGuestBody = z.infer<typeof AddGuestBodySchema>;

/** A person as a guest sees them: a name, and whether a guest may claim as them. */
export const ClaimPersonSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  /** Members with an account claim from inside the app, so guests cannot pick them. */
  hasAccount: z.boolean(),
});
export type ClaimPerson = z.infer<typeof ClaimPersonSchema>;

/** Everything the guest page needs. Deliberately free of emails, user ids and balances. */
export const ClaimPageSchema = z.object({
  groupName: z.string(),
  merchant: z.string().nullable(),
  date: z.string().nullable(),
  currency: z.string(),
  items: z.array(
    z.object({
      index: z.int().min(0),
      description: z.string(),
      quantity: z.number(),
      totalPriceCents: CentsSchema,
    }),
  ),
  taxCents: CentsSchema.nullable(),
  tipCents: CentsSchema.nullable(),
  feeCents: CentsSchema.nullable(),
  discountCents: CentsSchema.nullable(),
  totalCents: CentsSchema.nullable(),
  people: z.array(ClaimPersonSchema),
  claims: z.array(ReceiptClaimSchema),
  /** False once the link has added its quota of new names. */
  canAddGuest: z.boolean(),
  expiresAt: z.iso.datetime(),
});
export type ClaimPage = z.infer<typeof ClaimPageSchema>;
