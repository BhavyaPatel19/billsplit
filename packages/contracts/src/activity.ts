import { z } from "zod";
import { CentsSchema } from "./expenses.js";

const ExpenseFacts = z.object({
  description: z.string(),
  totalCents: CentsSchema,
  currency: z.string(),
  payerId: z.uuid(),
});
const PaymentFacts = z.object({
  fromId: z.uuid(),
  toId: z.uuid(),
  amountCents: CentsSchema,
  currency: z.string(),
});

/** Every kind of entry, with the facts copied at the time. */
export const ActivityPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("expense.added"), data: ExpenseFacts }),
  z.object({ kind: z.literal("expense.edited"), data: ExpenseFacts }),
  z.object({ kind: z.literal("expense.deleted"), data: ExpenseFacts }),
  z.object({ kind: z.literal("payment.recorded"), data: PaymentFacts }),
  z.object({ kind: z.literal("payment.removed"), data: PaymentFacts }),
  z.object({ kind: z.literal("member.joined"), data: z.object({ displayName: z.string() }) }),
  z.object({
    kind: z.literal("member.merged"),
    data: z.object({ placeholderName: z.string(), intoId: z.uuid() }),
  }),
]);
export type ActivityPayload = z.infer<typeof ActivityPayloadSchema>;
export type ActivityKind = ActivityPayload["kind"];

export const ActivitySchema = z.intersection(
  z.object({
    id: z.uuid(),
    /** Who did it; null if they were later removed. Merged placeholders resolve to the account. */
    actorId: z.uuid().nullable(),
    /** The expense, payment or participant it is about. */
    subjectId: z.uuid().nullable(),
    /** True when it touches the caller: they paid, owe, were paid, or did it. */
    involvesMe: z.boolean(),
    createdAt: z.iso.datetime(),
  }),
  ActivityPayloadSchema,
);
export type Activity = z.infer<typeof ActivitySchema>;

export const ActivityQuerySchema = z.object({
  /** Cursor from the previous page's `next`. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const ActivityListResponseSchema = z.object({
  activities: z.array(ActivitySchema),
  /** Pass as `cursor` for older entries; null when there are no more. */
  next: z.string().nullable(),
});
export type ActivityListResponse = z.infer<typeof ActivityListResponseSchema>;
