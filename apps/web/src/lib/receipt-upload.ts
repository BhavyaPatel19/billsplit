import {
  CreateReceiptResponseSchema,
  RECEIPT_CONTENT_TYPES,
  RECEIPT_MAX_BYTES,
  ReceiptSchema,
  type Receipt,
  type ReceiptContentType,
} from "@billsplit/contracts";
import { api } from "./api-client";

export type UploadStage = "starting" | "uploading" | "confirming";

export interface UploadReceiptDeps {
  /** Overrides same-origin API calls (defaults to `api`). */
  request?: typeof api;
  /** Overrides `fetch` for the direct-to-storage PUT (defaults to `globalThis.fetch`). */
  putFetch?: typeof fetch;
  onStageChange?: (stage: UploadStage) => void;
}

const EXTENSION_TYPES: Record<string, ReceiptContentType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Resolves an accepted receipt MIME type from `file.type`, falling back to the filename extension
 * when the browser omits `type`. Returns null for unsupported formats (such as PDF or HEIC).
 */
export function resolveReceiptContentType(
  file: Pick<File, "name" | "type">,
): ReceiptContentType | null {
  if ((RECEIPT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return file.type as ReceiptContentType;
  }
  if (!file.type) {
    const dot = file.name.lastIndexOf(".");
    if (dot >= 0) {
      return EXTENSION_TYPES[file.name.slice(dot).toLowerCase()] ?? null;
    }
  }
  return null;
}

/** Validates a receipt file before asking the API for a presigned PUT URL. */
export function validateReceiptFile(
  file: Pick<File, "name" | "size" | "type">,
): { ok: true; contentType: ReceiptContentType } | { ok: false; error: string } {
  const contentType = resolveReceiptContentType(file);
  if (!contentType) {
    return { ok: false, error: "Please choose a JPEG, PNG, or WebP photo." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "That file is empty." };
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    const maxMb = Math.round(RECEIPT_MAX_BYTES / 1024 / 1024);
    return { ok: false, error: `Receipts must be at most ${maxMb} MB.` };
  }
  return { ok: true, contentType };
}

/**
 * Three-step presigned receipt upload:
 * 1. Create the receipt record and get a signed PUT URL + headers from the API.
 * 2. PUT the file directly to object storage with the returned headers.
 * 3. Confirm the upload with the API so the worker can process it.
 */
export async function uploadReceiptFile(
  groupId: string,
  file: File,
  deps: UploadReceiptDeps = {},
): Promise<Receipt> {
  const checked = validateReceiptFile(file);
  if (!checked.ok) {
    throw new Error(checked.error);
  }

  const callApi = deps.request ?? api;
  const putFetch = deps.putFetch ?? globalThis.fetch;

  deps.onStageChange?.("starting");
  const { receipt, upload } = await callApi(
    `/groups/${groupId}/receipts`,
    CreateReceiptResponseSchema,
    { body: { contentType: checked.contentType, sizeBytes: file.size } },
  );

  deps.onStageChange?.("uploading");
  let putRes: Response;
  try {
    putRes = await putFetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: file,
    });
  } catch {
    throw new Error("Could not upload the photo to storage. Check your connection and try again.");
  }
  if (!putRes.ok) {
    throw new Error(`Storage rejected the upload (${putRes.status}). Please try again.`);
  }

  deps.onStageChange?.("confirming");
  return callApi(`/groups/${groupId}/receipts/${receipt.id}/complete`, ReceiptSchema, {
    method: "POST",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
