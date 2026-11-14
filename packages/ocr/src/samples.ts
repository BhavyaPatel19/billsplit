import {
  ReceiptSampleIdSchema,
  type ReceiptExtraction,
  type ReceiptSampleId,
} from "@billsplit/contracts";

/**
 * Expected extractions for the built-in sample receipts (ids in `RECEIPT_SAMPLES`). The worker
 * renders each one to an image and "extracts" it with these values, so the demo exercises the
 * whole pipeline without a paid OCR call.
 */
export const RECEIPT_SAMPLE_EXTRACTIONS: Record<ReceiptSampleId, ReceiptExtraction> = {
  "bistro-dinner": {
    merchant: "Corner Bistro",
    date: "2026-11-10",
    currency: "USD",
    items: [
      {
        description: "Margherita Pizza",
        quantity: 1,
        unitPriceCents: 1800,
        totalPriceCents: 1800,
        confidence: "high",
      },
      {
        description: "Pasta Carbonara",
        quantity: 2,
        unitPriceCents: 1650,
        totalPriceCents: 3300,
        confidence: "high",
      },
      {
        description: "Sparkling Water",
        quantity: 2,
        unitPriceCents: 450,
        totalPriceCents: 900,
        confidence: "medium",
      },
    ],
    subtotalCents: 6000,
    taxCents: 540,
    tipCents: 1080,
    feeCents: null,
    discountCents: null,
    totalCents: 7620,
  },
  "taco-night": {
    merchant: "Sunset Tacos",
    date: "2026-11-12",
    currency: "USD",
    items: [
      {
        description: "Al Pastor Tacos",
        quantity: 3,
        unitPriceCents: 450,
        totalPriceCents: 1350,
        confidence: "high",
      },
      {
        description: "Horchata",
        quantity: 1,
        unitPriceCents: 400,
        totalPriceCents: 400,
        confidence: "medium",
      },
    ],
    subtotalCents: 1750,
    taxCents: 158,
    tipCents: 350,
    feeCents: 100,
    discountCents: 200,
    totalCents: 2158,
  },
  // One line was misread, so items fall a dollar short of the printed total: needs review.
  "grocery-run": {
    merchant: "Greenleaf Market",
    date: "2026-11-11",
    currency: "USD",
    items: [
      {
        description: "Bananas",
        quantity: 1,
        unitPriceCents: null,
        totalPriceCents: 129,
        confidence: "high",
      },
      {
        description: "Oat Milk",
        quantity: 2,
        unitPriceCents: 449,
        totalPriceCents: 898,
        confidence: "high",
      },
      {
        description: "Sourdough Loaf",
        quantity: 1,
        unitPriceCents: null,
        totalPriceCents: 650,
        confidence: "high",
      },
      {
        description: "Free-range Eggs",
        quantity: 1,
        unitPriceCents: null,
        totalPriceCents: 599,
        confidence: "low",
      },
      {
        description: "Coffee Beans",
        quantity: 1,
        unitPriceCents: null,
        totalPriceCents: 1499,
        confidence: "high",
      },
    ],
    subtotalCents: 3875,
    taxCents: null,
    tipCents: null,
    feeCents: null,
    discountCents: null,
    totalCents: 3875,
  },
};

export function getReceiptSample(
  id: string,
): { id: ReceiptSampleId; extraction: ReceiptExtraction } | null {
  const parsed = ReceiptSampleIdSchema.safeParse(id);
  return parsed.success
    ? { id: parsed.data, extraction: RECEIPT_SAMPLE_EXTRACTIONS[parsed.data] }
    : null;
}

const WIDTH = 600;
const LINE = 32;
const MARGIN = 40;

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (ch) =>
    ch === "<"
      ? "&lt;"
      : ch === ">"
        ? "&gt;"
        : ch === "&"
          ? "&amp;"
          : ch === '"'
            ? "&quot;"
            : "&apos;",
  );

const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

/**
 * Draws a sample receipt as a plain SVG. sharp (librsvg) rasterises it in the worker, so the
 * sample flows through the same derive/thumbnail path as a real photo. In the printed version
 * the grocery receipt shows the true eggs price; the extraction above is the "misread".
 */
export function renderSampleReceiptSvg(id: ReceiptSampleId): string {
  const r = RECEIPT_SAMPLE_EXTRACTIONS[id];
  const rows: Array<{ left: string; right?: string; bold?: boolean; center?: boolean }> = [];
  rows.push({ left: r.merchant ?? "Receipt", bold: true, center: true });
  if (r.date) rows.push({ left: r.date, center: true });
  rows.push({ left: "-".repeat(38), center: true });
  for (const item of r.items) {
    const printed =
      id === "grocery-run" && item.description === "Free-range Eggs" ? 699 : item.totalPriceCents;
    const qty = item.quantity === 1 ? "" : `${item.quantity} x `;
    rows.push({ left: `${qty}${item.description}`, right: money(printed) });
  }
  rows.push({ left: "-".repeat(38), center: true });
  if (r.subtotalCents !== null) rows.push({ left: "Subtotal", right: money(r.subtotalCents) });
  if (r.taxCents !== null) rows.push({ left: "Tax", right: money(r.taxCents) });
  if (r.feeCents !== null) rows.push({ left: "Service fee", right: money(r.feeCents) });
  if (r.discountCents !== null) rows.push({ left: "Discount", right: money(-r.discountCents) });
  if (r.tipCents !== null) rows.push({ left: "Tip", right: money(r.tipCents) });
  if (r.totalCents !== null) rows.push({ left: "TOTAL", right: money(r.totalCents), bold: true });
  rows.push({ left: "Thank you!", center: true });

  const height = MARGIN * 2 + rows.length * LINE;
  const text = rows
    .map((row, i) => {
      const y = MARGIN + (i + 1) * LINE - 8;
      const weight = row.bold ? ' font-weight="bold"' : "";
      if (row.center) {
        return `<text x="${WIDTH / 2}" y="${y}" text-anchor="middle"${weight}>${escapeXml(row.left)}</text>`;
      }
      const right = row.right
        ? `<text x="${WIDTH - MARGIN}" y="${y}" text-anchor="end"${weight}>${escapeXml(row.right)}</text>`
        : "";
      return `<text x="${MARGIN}" y="${y}"${weight}>${escapeXml(row.left)}</text>${right}`;
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" ` +
    `viewBox="0 0 ${WIDTH} ${height}">` +
    `<rect width="100%" height="100%" fill="#fbfaf6"/>` +
    `<g font-family="DejaVu Sans Mono, Menlo, Courier New, monospace" font-size="22" fill="#1f1f1f">` +
    text +
    `</g></svg>`
  );
}
