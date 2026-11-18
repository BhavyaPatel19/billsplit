import { z } from "zod";
import { CurrencySchema } from "./groups.js";
import { CentsSchema, ExpenseInputSchema } from "./expenses.js";

/** What gets posted each time: an expense request without a date (each posting has its own). */
export const RecurringTemplateSchema = ExpenseInputSchema.omit({ spentOn: true });
export type RecurringTemplate = z.infer<typeof RecurringTemplateSchema>;

export const RecurrenceFrequencySchema = z.enum(["weekly", "monthly"]);
export type RecurrenceFrequency = z.infer<typeof RecurrenceFrequencySchema>;

export const CreateRecurringBodySchema = z
  .object({
    expense: RecurringTemplateSchema,
    frequency: RecurrenceFrequencySchema,
    /** Every N weeks or months. */
    interval: z.int().min(1).max(12).default(1),
    /**
     * First occurrence. May be up to 31 days in the past, so rent set up mid-month that was due
     * on the 1st is posted right away.
     */
    startOn: z.iso.date(),
    /** Last day an occurrence may fall on (a lease end). */
    endOn: z.iso.date().optional(),
  })
  .refine((b) => !b.endOn || b.endOn >= b.startOn, {
    path: ["endOn"],
    message: "End date must be on or after the start date",
  });
export type CreateRecurringBody = z.infer<typeof CreateRecurringBodySchema>;

export const UpdateRecurringBodySchema = z
  .object({
    /** Pause, or resume. Resuming continues from today: paused occurrences are not posted. */
    paused: z.boolean().optional(),
    /** Change what future postings look like; already posted expenses stay as they were. */
    expense: RecurringTemplateSchema.optional(),
    /** Null removes the end date. */
    endOn: z.iso.date().nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "Nothing to change",
  });
export type UpdateRecurringBody = z.infer<typeof UpdateRecurringBodySchema>;

export const RecurringStatusSchema = z.enum(["active", "paused", "ended"]);
export type RecurringStatus = z.infer<typeof RecurringStatusSchema>;

export const RecurringExpenseSchema = z.object({
  id: z.uuid(),
  description: z.string(),
  currency: CurrencySchema,
  /** Total of one posting. */
  totalCents: CentsSchema,
  expense: RecurringTemplateSchema,
  frequency: RecurrenceFrequencySchema,
  interval: z.int(),
  startOn: z.iso.date(),
  endOn: z.iso.date().nullable(),
  /** Date of the next posting; null once the schedule has ended. */
  nextOn: z.iso.date().nullable(),
  status: RecurringStatusSchema,
  /** Set when BillSplit paused it on its own, saying why. */
  pausedReason: z.string().nullable(),
  /** Expenses posted so far (deleted ones included). */
  postedCount: z.int(),
  createdById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type RecurringExpense = z.infer<typeof RecurringExpenseSchema>;

export const RecurringListResponseSchema = z.object({
  recurring: z.array(RecurringExpenseSchema),
});
export type RecurringListResponse = z.infer<typeof RecurringListResponseSchema>;
