import type { ClaimPage, ReceiptClaim } from "@billsplit/contracts";

type Totals = Pick<ClaimPage, "items" | "taxCents" | "tipCents" | "feeCents" | "discountCents">;

/** What each claimant owes for one line: percent claims first, the rest shared equally. */
export function lineShares(totalCents: number, claims: ReceiptClaim[]): Map<string, number> {
  const shares = new Map<string, number>();
  let fixed = 0;
  for (const claim of claims) {
    if (claim.percent === null) continue;
    const amount = Math.round((totalCents * claim.percent) / 100);
    shares.set(claim.participantId, amount);
    fixed += amount;
  }
  const equal = claims.filter((c) => c.percent === null);
  const rest = Math.max(0, totalCents - fixed);
  equal.forEach((claim, i) => {
    // Hand the leftover cents to the first claimants so the line still adds up.
    const base = Math.floor(rest / equal.length);
    shares.set(claim.participantId, base + (i < rest % equal.length ? 1 : 0));
  });
  return shares;
}

export interface ClaimShare {
  /** Their part of the lines they tapped. */
  itemsCents: number;
  /** Their part of tax, tip and fees less discounts, in proportion to `itemsCents`. */
  extrasCents: number;
  totalCents: number;
}

/**
 * Roughly what one person owes given everyone's claims so far. It is an estimate for the guest
 * page: it moves as other people claim shared lines, and the host's final split is what counts.
 */
export function estimateShare(
  page: Totals,
  claims: ReceiptClaim[],
  participantId: string,
): ClaimShare {
  let itemsCents = 0;
  for (const item of page.items) {
    const onLine = claims.filter((c) => c.itemIndex === item.index);
    itemsCents += lineShares(item.totalPriceCents, onLine).get(participantId) ?? 0;
  }
  const itemsSum = page.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const extras =
    (page.taxCents ?? 0) + (page.tipCents ?? 0) + (page.feeCents ?? 0) - (page.discountCents ?? 0);
  const extrasCents = itemsSum > 0 ? Math.round((extras * itemsCents) / itemsSum) : 0;
  return { itemsCents, extrasCents, totalCents: itemsCents + extrasCents };
}

/** Lines nobody has tapped yet. */
export function unclaimedCount(page: Pick<ClaimPage, "items">, claims: ReceiptClaim[]): number {
  const claimed = new Set(claims.map((c) => c.itemIndex));
  return page.items.filter((item) => !claimed.has(item.index)).length;
}
