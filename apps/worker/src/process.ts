import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import type { ReceiptOcr } from "@billsplit/contracts";
import { schema, type Db } from "@billsplit/db";
import {
  OcrRefusalError,
  reconcileReceiptExtraction,
  type OcrProvider,
  type OcrResult,
} from "@billsplit/ocr";
import { receiptKeys, type ReceiptStorage } from "@billsplit/storage";
import type { Logger } from "./logger.js";

/** Longest side of the stored image; receipts are legible well below this. */
export const MAX_IMAGE_PX = 2000;
export const THUMBNAIL_PX = 320;

export interface ProcessDeps {
  db: Db;
  storage: ReceiptStorage;
  ocr: OcrProvider;
  logger: Logger;
}

export type ProcessOutcome =
  /** Images stored and OCR reconciled; receipt marked ready. */
  | "ready"
  /** Images stored and OCR saved, but totals did not reconcile; user should review. */
  | "needs_review"
  /** The file cannot be processed; the receipt is marked failed with a reason for the uploader. */
  | "failed"
  /** Nothing to do: unknown receipt, or already past processing. */
  | "skipped";

/** A problem with the file itself. Retrying will not help, so the job must not be retried. */
export class UnprocessableReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnprocessableReceiptError";
  }
}

/**
 * Re-encode the upload to a JPEG with the camera's metadata (EXIF, GPS, thumbnails) stripped,
 * the orientation applied, and the longest side at most {@link MAX_IMAGE_PX}; plus a thumbnail.
 * sharp drops metadata unless asked to keep it.
 */
export async function deriveImages(
  original: Uint8Array,
): Promise<{ image: Buffer; thumbnail: Buffer; width: number; height: number }> {
  const base = sharp(original, { failOn: "error" }).rotate();
  const { data: image, info } = await base
    .clone()
    .resize({ width: MAX_IMAGE_PX, height: MAX_IMAGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const thumbnail = await sharp(image)
    .resize({ width: THUMBNAIL_PX, height: THUMBNAIL_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
  return { image, thumbnail, width: info.width, height: info.height };
}

/**
 * One receipt, end to end. Safe to run again after a partial failure: a receipt already marked
 * ready only has its original cleaned up, and a derived image is simply overwritten.
 *
 * Throws for transient trouble (storage, database) so the queue can retry; file problems are
 * recorded on the receipt and returned as `"failed"` without throwing.
 */
export async function processReceipt(
  { db, storage, ocr, logger }: ProcessDeps,
  receiptId: string,
): Promise<ProcessOutcome> {
  const log = logger.child({ receiptId });
  const [receipt] = await db
    .select()
    .from(schema.receipts)
    .where(eq(schema.receipts.id, receiptId))
    .limit(1);
  if (!receipt) {
    log.warn("receipt not found; skipping");
    return "skipped";
  }

  if (receipt.status === "ready" || receipt.status === "needs_review") {
    // A previous attempt stored the images but did not finish deleting the original.
    if (await storage.head(receipt.originalKey)) {
      await storage.delete(receipt.originalKey);
      log.info("removed leftover original");
    }
    return "skipped";
  }
  if (receipt.status !== "uploaded" && receipt.status !== "processing") {
    log.info({ status: receipt.status }, "receipt not awaiting processing; skipping");
    return "skipped";
  }

  await db
    .update(schema.receipts)
    .set({ status: "processing", error: null })
    .where(
      and(
        eq(schema.receipts.id, receiptId),
        inArray(schema.receipts.status, ["uploaded", "processing"]),
      ),
    );

  const fail = async (reason: string): Promise<ProcessOutcome> => {
    await db
      .update(schema.receipts)
      .set({ status: "failed", error: reason })
      .where(eq(schema.receipts.id, receiptId));
    log.warn({ reason }, "receipt failed");
    return "failed";
  };

  const original = await storage.get(receipt.originalKey);
  if (!original) return fail("The uploaded file is no longer in storage");

  let derived: Awaited<ReturnType<typeof deriveImages>>;
  try {
    derived = await deriveImages(original);
  } catch (err) {
    log.info({ err }, "image could not be decoded");
    return fail("The file could not be read as an image");
  }

  const keys = receiptKeys(receipt.groupId, receipt.id);
  await Promise.all([
    storage.put(keys.image, derived.image, "image/jpeg"),
    storage.put(keys.thumbnail, derived.thumbnail, "image/jpeg"),
  ]);

  let ocrResult: OcrResult;
  try {
    ocrResult = await ocr.extract({ image: derived.image, mediaType: "image/jpeg" });
  } catch (err) {
    if (err instanceof OcrRefusalError) {
      return fail("This image cannot be processed as a receipt");
    }
    throw err;
  }

  const reconciliation = reconcileReceiptExtraction(ocrResult.extraction);
  const ocrPayload: ReceiptOcr = {
    ...ocrResult.extraction,
    reconciliation,
    model: ocrResult.model,
    provider: ocrResult.provider,
  };
  const nextStatus = reconciliation.matches ? "ready" : "needs_review";

  await db
    .update(schema.receipts)
    .set({
      status: nextStatus,
      imageKey: keys.image,
      thumbnailKey: keys.thumbnail,
      ocr: ocrPayload,
      ocrCostMicroUsd: ocrResult.usage.costMicroUsd,
      error: null,
    })
    .where(eq(schema.receipts.id, receiptId));
  // Last, so a failure here is retried by the cleanup branch above rather than re-encoding.
  await storage.delete(receipt.originalKey);

  log.info(
    {
      status: nextStatus,
      model: ocrResult.model,
      provider: ocrResult.provider,
      itemCount: ocrResult.extraction.items.length,
      reconciled: reconciliation.matches,
      costMicroUsd: ocrResult.usage.costMicroUsd,
      width: derived.width,
      height: derived.height,
      originalBytes: original.byteLength,
      imageBytes: derived.image.byteLength,
    },
    "receipt processed",
  );
  return nextStatus;
}
