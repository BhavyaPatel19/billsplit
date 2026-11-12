import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups.js";

/**
 * `awaiting_upload`: a presigned PUT was issued, nothing confirmed yet. `uploaded`: the object
 * was checked (size, type) and a processing job was queued. The worker moves it on to
 * `processing`, then `needs_review` (totals do not reconcile), `ready` or `failed`.
 */
export const receiptStatus = pgEnum("receipt_status", [
  "awaiting_upload",
  "uploaded",
  "processing",
  "needs_review",
  "ready",
  "failed",
]);

export const receipts = pgTable(
  "receipts",
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    uploadedBy: uuid().references(() => participants.id, { onDelete: "set null" }),
    status: receiptStatus().notNull().default("awaiting_upload"),
    /** Content type the client declared and the presigned PUT is signed for. */
    contentType: text().notNull(),
    /** Size the client declared; the upload is signed for exactly this many bytes. */
    sizeBytes: integer().notNull(),
    /** The upload as received. Deleted by the worker once the re-encoded copy exists. */
    originalKey: text().notNull(),
    /** Re-encoded JPEG (EXIF/GPS stripped, max 2000 px) and its thumbnail; set by the worker. */
    imageKey: text(),
    thumbnailKey: text(),
    /** Validated OCR extraction (packages/ocr); set by the worker. */
    ocr: jsonb(),
    /** OCR cost in millionths of a US dollar, so cheap calls are not rounded to zero. */
    ocrCostMicroUsd: bigint({ mode: "number" }),
    /** Why processing failed, safe to show the uploader. */
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("receipts_group_created_idx").on(t.groupId, t.createdAt),
    check("receipts_size_positive", sql`${t.sizeBytes} > 0`),
  ],
);
