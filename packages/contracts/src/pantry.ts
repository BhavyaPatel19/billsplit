import { z } from "zod";
import { CentsSchema } from "./expenses.js";

export const PantryItemInputSchema = z.object({
  name: z.string().trim().min(1, "Name the item").max(120),
  /** What the whole line cost (all units). */
  amountCents: CentsSchema.min(0),
});
export type PantryItemInput = z.infer<typeof PantryItemInputSchema>;

const Extras = {
  taxCents: CentsSchema.min(0).default(0),
  feeCents: CentsSchema.min(0).default(0),
  discountCents: CentsSchema.min(0).default(0),
};

/**
 * Stock the pantry from a bulk shop: typed in, or taken from a scanned receipt (its reviewed
 * lines, tax, fees and discounts).
 */
export const CreatePantryRunBodySchema = z.union([
  z.object({
    receiptId: z.uuid(),
    /** Who paid; defaults to whoever uploaded the receipt. */
    payerId: z.uuid().optional(),
  }),
  z.object({
    description: z.string().trim().min(1, "Describe the shop").max(120),
    payerId: z.uuid(),
    boughtOn: z.iso.date().optional(),
    items: z.array(PantryItemInputSchema).min(1, "Add at least one item").max(200),
    ...Extras,
  }),
]);
export type CreatePantryRunBody = z.infer<typeof CreatePantryRunBodySchema>;

/** Set how much of an item someone used (0 clears it). Repeating the same call is harmless. */
export const SetPantryUseBodySchema = z.object({ units: z.int().min(0).max(99) });
export type SetPantryUseBody = z.infer<typeof SetPantryUseBodySchema>;

export const PantryUseSchema = z.object({ participantId: z.uuid(), units: z.int() });

export const PantryItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  amountCents: CentsSchema,
  uses: z.array(PantryUseSchema),
});
export type PantryItem = z.infer<typeof PantryItemSchema>;

export const PantryRunSchema = z.object({
  id: z.uuid(),
  description: z.string(),
  payerId: z.uuid(),
  boughtOn: z.iso.date(),
  currency: z.string(),
  /** open: people are still marking what they used. settled: posted as `expenseId`. */
  status: z.enum(["open", "settled"]),
  receiptId: z.uuid().nullable(),
  expenseId: z.uuid().nullable(),
  items: z.array(PantryItemSchema),
  taxCents: CentsSchema,
  feeCents: CentsSchema,
  discountCents: CentsSchema,
  totalCents: CentsSchema,
  createdById: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  settledAt: z.iso.datetime().nullable(),
});
export type PantryRun = z.infer<typeof PantryRunSchema>;

export const PantryListResponseSchema = z.object({ runs: z.array(PantryRunSchema) });
export type PantryListResponse = z.infer<typeof PantryListResponseSchema>;
