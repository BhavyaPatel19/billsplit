import { z } from "zod";
import { ProrationBasisSchema } from "./expenses.js";

export const HouseholdResidentSchema = z.object({
  participantId: z.uuid(),
  /** Share of the rent their room carries (square feet, or relative). 1 when unset. */
  roomWeight: z.number(),
  movedInOn: z.iso.date().nullable(),
  movedOutOn: z.iso.date().nullable(),
});
export type HouseholdResident = z.infer<typeof HouseholdResidentSchema>;

export const AwayPeriodSchema = z.object({
  id: z.uuid(),
  participantId: z.uuid(),
  from: z.iso.date(),
  to: z.iso.date(),
  note: z.string().nullable(),
});
export type AwayPeriod = z.infer<typeof AwayPeriodSchema>;

export const HouseholdResponseSchema = z.object({
  /** One entry per current member, defaults filled in. */
  residents: z.array(HouseholdResidentSchema),
  away: z.array(AwayPeriodSchema),
});
export type HouseholdResponse = z.infer<typeof HouseholdResponseSchema>;

export const UpdateResidentBodySchema = z
  .object({
    roomWeight: z.number().min(0).max(1_000_000).optional(),
    /** Null clears it (there from the start). */
    movedInOn: z.iso.date().nullable().optional(),
    /** Null clears it (still living there). */
    movedOutOn: z.iso.date().nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to change" });
export type UpdateResidentBody = z.infer<typeof UpdateResidentBodySchema>;

export const CreateAwayBodySchema = z
  .object({
    participantId: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date(),
    note: z.string().trim().max(120).optional(),
  })
  .refine((b) => b.from <= b.to, { path: ["to"], message: "The trip ends before it starts" });
export type CreateAwayBody = z.infer<typeof CreateAwayBodySchema>;

/** GET /groups/:id/household/split: a household split built from the current settings. */
export const HouseholdSplitQuerySchema = z
  .object({
    basis: ProrationBasisSchema,
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((q) => q.from <= q.to, { path: ["to"], message: "The period ends before it starts" })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 366 * 86_400_000, {
    path: ["to"],
    message: "A household bill covers at most a year",
  });
export type HouseholdSplitQuery = z.infer<typeof HouseholdSplitQuerySchema>;
