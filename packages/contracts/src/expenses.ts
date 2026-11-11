import { z } from "zod";
import { CurrencySchema } from "./groups.js";

/** Amount in minor units (cents). Always an integer. */
export const CentsSchema = z.int().describe("Amount in minor units (cents)");

const ParticipantId = z.uuid();

export const SplitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("equal"), participantIds: z.array(ParticipantId).min(1).max(100) }),
  z.object({
    kind: z.literal("exact"),
    amounts: z
      .array(z.object({ participantId: ParticipantId, amount: CentsSchema.min(0) }))
      .min(1)
      .max(100),
  }),
  z.object({
    kind: z.literal("percent"),
    percents: z
      .array(z.object({ participantId: ParticipantId, percent: z.number().min(0).max(100) }))
      .min(1)
      .max(100),
  }),
  z.object({
    kind: z.literal("shares"),
    shares: z
      .array(z.object({ participantId: ParticipantId, shares: z.int().min(0).max(1000) }))
      .min(1)
      .max(100),
  }),
]);
export type SplitInput = z.infer<typeof SplitSchema>;

export const ExpenseItemInputSchema = z.object({
  name: z.string().trim().min(1, "Name the item").max(120),
  /** Unit price. */
  amountCents: CentsSchema.min(0),
  quantity: z.int().min(1).max(999).default(1),
  split: SplitSchema,
});
export type ExpenseItemInput = z.infer<typeof ExpenseItemInputSchema>;

export const AdjustmentKindSchema = z.enum(["tax", "tip", "discount", "fee"]);
export const AdjustmentAllocationSchema = z.enum(["proportional", "equal", "payer"]);

export const AdjustmentInputSchema = z.object({
  kind: AdjustmentKindSchema,
  /** Positive magnitude; a discount reduces the bill. */
  amountCents: CentsSchema.min(0),
  allocation: AdjustmentAllocationSchema.default("proportional"),
});
export type AdjustmentInput = z.infer<typeof AdjustmentInputSchema>;

export const ExpenseInputSchema = z.object({
  description: z.string().trim().min(1, "Describe the expense").max(120),
  /** ISO date; defaults to today. */
  spentOn: z.iso.date().optional(),
  payerId: ParticipantId,
  items: z.array(ExpenseItemInputSchema).min(1, "Add at least one item").max(200),
  adjustments: z.array(AdjustmentInputSchema).max(20).default([]),
});
export type ExpenseInput = z.infer<typeof ExpenseInputSchema>;

/** Participant id -> amount. */
export const AmountsByParticipantSchema = z.record(z.string(), CentsSchema);

export const ExpenseShareSchema = z.object({
  participantId: z.uuid(),
  paidCents: CentsSchema,
  /** Their share of the bill after tax, tip, fees and discounts. */
  owedCents: CentsSchema,
});
export type ExpenseShare = z.infer<typeof ExpenseShareSchema>;

export const ExpenseSummarySchema = z.object({
  id: z.uuid(),
  version: z.int().min(1),
  description: z.string(),
  currency: CurrencySchema,
  spentOn: z.iso.date(),
  payerId: z.uuid(),
  totalCents: CentsSchema,
  shares: z.array(ExpenseShareSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ExpenseSummary = z.infer<typeof ExpenseSummarySchema>;

export const ExpenseDetailSchema = ExpenseSummarySchema.extend({
  items: z.array(
    ExpenseItemInputSchema.extend({
      totalCents: CentsSchema,
      perParticipant: AmountsByParticipantSchema,
    }),
  ),
  adjustments: z.array(
    AdjustmentInputSchema.extend({ perParticipant: AmountsByParticipantSchema }),
  ),
});
export type ExpenseDetail = z.infer<typeof ExpenseDetailSchema>;

export const ExpenseListResponseSchema = z.object({ expenses: z.array(ExpenseSummarySchema) });
export type ExpenseListResponse = z.infer<typeof ExpenseListResponseSchema>;

export const TransferSchema = z.object({
  fromId: z.uuid(),
  toId: z.uuid(),
  amountCents: CentsSchema.positive(),
});
export type Transfer = z.infer<typeof TransferSchema>;

export const BalancesResponseSchema = z.object({
  currency: CurrencySchema,
  /** Positive: the group owes them. Negative: they owe the group. Sums to zero. */
  balances: z.array(z.object({ participantId: z.uuid(), netCents: CentsSchema })),
  /** Fewest payments that settle everyone up. */
  transfers: z.array(TransferSchema),
});
export type BalancesResponse = z.infer<typeof BalancesResponseSchema>;

export const CreateSettlementBodySchema = z
  .object({
    fromId: ParticipantId,
    toId: ParticipantId,
    amountCents: CentsSchema.positive(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((b) => b.fromId !== b.toId, { path: ["toId"], message: "Pick two different people" });
export type CreateSettlementBody = z.infer<typeof CreateSettlementBodySchema>;

export const SettlementSchema = z.object({
  id: z.uuid(),
  fromId: z.uuid(),
  toId: z.uuid(),
  amountCents: CentsSchema,
  currency: CurrencySchema,
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const SettlementListResponseSchema = z.object({ settlements: z.array(SettlementSchema) });
