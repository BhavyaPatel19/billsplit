import type { ExpenseInput } from "@billsplit/contracts";

export interface PantryRunFacts {
  description: string;
  payerId: string;
  boughtOn: string;
  taxCents: number;
  feeCents: number;
  discountCents: number;
}

export interface PantryItemFacts {
  name: string;
  amountCents: number;
  uses: readonly { participantId: string; units: number }[];
}

/**
 * The expense a settled pantry run posts. Each item is split by how many units each person
 * marked (the existing `shares` split). An item nobody marked is shared equally by everyone who
 * used anything from the run, or by `everyone` if nobody marked anything at all. Tax, fees and
 * discounts follow what each person had.
 *
 * `resolve` maps merged placeholders to the account they became; their units are added up.
 */
export function pantryExpenseInput(
  run: PantryRunFacts,
  items: readonly PantryItemFacts[],
  everyone: readonly string[],
  resolve: (participantId: string) => string = (id) => id,
): ExpenseInput {
  const merged = items.map((item) => {
    const units = new Map<string, number>();
    for (const u of item.uses) {
      if (u.units <= 0) continue;
      const id = resolve(u.participantId);
      units.set(id, (units.get(id) ?? 0) + u.units);
    }
    return { ...item, units };
  });
  const users = [...new Set(merged.flatMap((i) => [...i.units.keys()]))];
  const unclaimedGoTo = users.length > 0 ? users : [...everyone];

  return {
    description: run.description,
    spentOn: run.boughtOn,
    payerId: resolve(run.payerId),
    items: merged.map((item) => ({
      name: item.name,
      amountCents: item.amountCents,
      quantity: 1,
      split:
        item.units.size > 0
          ? {
              kind: "shares" as const,
              shares: [...item.units].map(([participantId, shares]) => ({ participantId, shares })),
            }
          : { kind: "equal" as const, participantIds: unclaimedGoTo },
    })),
    adjustments: (
      [
        ["tax", run.taxCents],
        ["fee", run.feeCents],
        ["discount", run.discountCents],
      ] as const
    )
      .filter(([, amount]) => amount > 0)
      .map(([kind, amountCents]) => ({ kind, amountCents, allocation: "proportional" as const })),
  };
}
