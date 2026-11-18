import { z } from "zod";
import { CentsSchema, TransferSchema } from "./expenses.js";

export const ReportQuerySchema = z
  .object({
    /** First and last day to include (both optional: the whole history). */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ["to"],
    message: "The period ends before it starts",
  });
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export const ReportPersonSchema = z.object({
  participantId: z.uuid(),
  name: z.string(),
  /** Within the period: what they paid for, their share, and payments sent and received. */
  paidCents: CentsSchema,
  owedCents: CentsSchema,
  sentCents: CentsSchema,
  receivedCents: CentsSchema,
  /** paid - owed + sent - received within the period. */
  periodNetCents: CentsSchema,
  /** Their balance today, across all time: what settling up is based on. */
  balanceCents: CentsSchema,
});
export type ReportPerson = z.infer<typeof ReportPersonSchema>;

export const ReportSchema = z.object({
  groupName: z.string(),
  currency: z.string(),
  from: z.iso.date().nullable(),
  to: z.iso.date().nullable(),
  generatedAt: z.iso.datetime(),
  people: z.array(ReportPersonSchema),
  expenses: z.array(
    z.object({
      id: z.uuid(),
      spentOn: z.iso.date(),
      description: z.string(),
      payerId: z.uuid(),
      totalCents: CentsSchema,
      /** Participant id -> share owed. */
      shares: z.record(z.string(), CentsSchema),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.uuid(),
      on: z.iso.date(),
      fromId: z.uuid(),
      toId: z.uuid(),
      amountCents: CentsSchema,
      note: z.string().nullable(),
    }),
  ),
  /** Fewest payments that settle everyone today. */
  settleUp: z.array(TransferSchema),
  totals: z.object({ expensesCents: CentsSchema, paymentsCents: CentsSchema }),
});
export type Report = z.infer<typeof ReportSchema>;
