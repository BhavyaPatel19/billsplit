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
