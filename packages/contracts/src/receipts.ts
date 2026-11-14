import { z } from "zod";

/** Uploads larger than this are refused before a URL is signed, and again when confirmed. */
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

/** Formats the worker's bundled libvips can decode everywhere; HEIC is not among them, and
 * iOS Safari converts HEIC to JPEG for web uploads anyway. */
export const RECEIPT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const ReceiptContentTypeSchema = z.enum(RECEIPT_CONTENT_TYPES);
export type ReceiptContentType = z.infer<typeof ReceiptContentTypeSchema>;

export const ReceiptStatusSchema = z.enum([
  "awaiting_upload",
  "uploaded",
  "processing",
  "needs_review",
  "ready",
  "failed",
]);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

export const CreateReceiptBodySchema = z.object({
  contentType: ReceiptContentTypeSchema,
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(RECEIPT_MAX_BYTES, `Receipts must be at most ${RECEIPT_MAX_BYTES / 1024 / 1024} MB`),
});
export type CreateReceiptBody = z.infer<typeof CreateReceiptBodySchema>;

/**
 * Built-in sample receipts. The worker renders them itself and extracts them with a fixture,
 * so trying the app never spends Anthropic credit. `grocery-run` deliberately does not add up,
 * to show the review flow.
 */
export const RECEIPT_SAMPLES = [
  { id: "bistro-dinner", title: "Dinner at Corner Bistro", summary: "3 dishes, tax and tip" },
  { id: "taco-night", title: "Taco night", summary: "Fees and a discount" },
  { id: "grocery-run", title: "Grocery run", summary: "Totals don't add up" },
] as const;

export const ReceiptSampleIdSchema = z.enum(["bistro-dinner", "taco-night", "grocery-run"]);
export type ReceiptSampleId = z.infer<typeof ReceiptSampleIdSchema>;

export const CreateSampleReceiptBodySchema = z.object({ sampleId: ReceiptSampleIdSchema });
export type CreateSampleReceiptBody = z.infer<typeof CreateSampleReceiptBodySchema>;

export const OcrConfidenceSchema = z.enum(["high", "medium", "low"]);
export type OcrConfidence = z.infer<typeof OcrConfidenceSchema>;

export const ReceiptOcrItemSchema = z.object({
  description: z.string().describe("Menu or receipt line-item label"),
  quantity: z.number().positive().describe("Item quantity; default 1 if omitted on receipt"),
  unitPriceCents: z
    .number()
    .int()
    .nullable()
    .describe("Unit price in minor currency units (e.g. cents), or null if not shown"),
  totalPriceCents: z
    .number()
    .int()
    .describe("Extended line-item total price in minor currency units (e.g. cents)"),
  confidence: OcrConfidenceSchema.describe("Extraction confidence for this line item"),
});
export type ReceiptOcrItem = z.infer<typeof ReceiptOcrItemSchema>;

/** Structured fields extracted directly from a receipt image by an OCR provider. */
export const ReceiptExtractionSchema = z.object({
  merchant: z.string().nullable().describe("Merchant or restaurant name, or null if unreadable"),
  date: z.string().nullable().describe("Receipt date in YYYY-MM-DD if shown, else null"),
  currency: z
    .string()
    .nullable()
    .describe("ISO 4217 3-letter currency code (e.g. USD, EUR), or null if unknown"),
  items: z.array(ReceiptOcrItemSchema).describe("Individual purchased line items"),
  subtotalCents: z.number().int().nullable().describe("Printed subtotal in minor units, or null"),
  taxCents: z.number().int().nullable().describe("Printed tax in minor units, or null"),
  tipCents: z.number().int().nullable().describe("Printed tip or gratuity in minor units, or null"),
  feeCents: z
    .number()
    .int()
    .nullable()
    .describe("Printed service/delivery/surcharge fees in minor units, or null"),
  discountCents: z
    .number()
    .int()
    .nullable()
    .describe("Printed discount magnitude subtracted from subtotal in minor units, or null"),
  totalCents: z.number().int().nullable().describe("Printed grand total in minor units, or null"),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

export const ReceiptReconciliationSchema = z.object({
  matches: z.boolean(),
  itemsSumCents: z.number().int(),
  computedTotalCents: z.number().int(),
  discrepancyCents: z.number().int().nullable(),
  reason: z.string().nullable(),
});
export type ReceiptReconciliation = z.infer<typeof ReceiptReconciliationSchema>;

export const ReceiptOcrSchema = ReceiptExtractionSchema.extend({
  reconciliation: ReceiptReconciliationSchema,
  model: z.string(),
  provider: z.enum(["claude", "fixture"]),
});
export type ReceiptOcr = z.infer<typeof ReceiptOcrSchema>;

export const ReceiptSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  status: ReceiptStatusSchema,
  contentType: ReceiptContentTypeSchema,
  sizeBytes: z.number().int().positive(),
  /** Participant who uploaded it; null if that participant was removed. */
  uploadedBy: z.uuid().nullable(),
  /** Short-lived signed GET URLs, present once the worker has produced the images. */
  imageUrl: z.url().nullable(),
  thumbnailUrl: z.url().nullable(),
  /** Set for built-in sample receipts, which are never sent to a paid OCR provider. */
  sampleId: ReceiptSampleIdSchema.nullable(),
  ocr: ReceiptOcrSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/** The browser PUTs the file to `url` with exactly these headers, before `expiresAt`. */
export const ReceiptUploadSchema = z.object({
  url: z.url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export type ReceiptUpload = z.infer<typeof ReceiptUploadSchema>;

export const CreateReceiptResponseSchema = z.object({
  receipt: ReceiptSchema,
  upload: ReceiptUploadSchema,
});
export type CreateReceiptResponse = z.infer<typeof CreateReceiptResponseSchema>;

export const ReceiptListResponseSchema = z.object({ receipts: z.array(ReceiptSchema) });
export type ReceiptListResponse = z.infer<typeof ReceiptListResponseSchema>;
