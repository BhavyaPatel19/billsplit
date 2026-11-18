import { and, eq, gte, lte } from "drizzle-orm";
import { schema, type Db } from "@billsplit/db";
import type { HouseholdSplitInput, ProrationBasis, ResidentInput } from "@billsplit/contracts";
import type { ParticipantResolver } from "./ledger.js";

/**
 * Build a household split for a period from the group's current household settings.
 *
 * Who is on it: everyone in the group whose stay overlaps the period, or, with `include`,
 * those people plus anyone with a move-in date (so a roommate who moves in mid-lease joins
 * repeating bills without anyone editing them). Each resident's room weight, move dates and
 * the trips that overlap the period are copied into the split.
 *
 * Returns null when nobody lived there during the period.
 */
export async function householdSnapshot(
  db: Db,
  groupId: string,
  resolver: ParticipantResolver,
  args: {
    basis: ProrationBasis;
    period: { from: string; to: string };
    include?: Iterable<string>;
  },
): Promise<HouseholdSplitInput | null> {
  const { from, to } = args.period;
  const [rows, away] = await Promise.all([
    db
      .select()
      .from(schema.householdResidents)
      .where(eq(schema.householdResidents.groupId, groupId)),
    db
      .select()
      .from(schema.awayPeriods)
      .where(
        and(
          eq(schema.awayPeriods.groupId, groupId),
          lte(schema.awayPeriods.fromOn, to),
          gte(schema.awayPeriods.toOn, from),
        ),
      ),
  ]);
  const byId = new Map(rows.map((r) => [r.participantId, r]));

  let candidates: string[];
  if (args.include) {
    const wanted = new Set([...args.include].map((id) => resolver.resolve(id)));
    for (const r of rows) if (r.movedInOn) wanted.add(r.participantId);
    candidates = [...wanted].filter((id) => resolver.active.has(id));
  } else {
    candidates = [...resolver.active];
  }

  const residents: ResidentInput[] = [];
  for (const id of candidates) {
    const row = byId.get(id);
    if (row?.movedInOn && row.movedInOn > to) continue;
    if (row?.movedOutOn && row.movedOutOn < from) continue;
    const trips = away
      .filter((a) => a.participantId === id)
      .map((a) => ({ from: a.fromOn < from ? from : a.fromOn, to: a.toOn > to ? to : a.toOn }));
    residents.push({
      participantId: id,
      ...(row && row.roomWeight !== 1 ? { weight: row.roomWeight } : {}),
      ...(row?.movedInOn && row.movedInOn > from ? { movedInOn: row.movedInOn } : {}),
      ...(row?.movedOutOn && row.movedOutOn < to ? { movedOutOn: row.movedOutOn } : {}),
      ...(trips.length > 0 ? { away: trips } : {}),
    });
  }
  if (residents.length === 0) return null;
  return { kind: "household", basis: args.basis, period: { from, to }, residents };
}
