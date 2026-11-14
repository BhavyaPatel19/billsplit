import { describe, expect, it, vi } from "vitest";
import { RECEIPT_MAX_BYTES, type Receipt } from "@billsplit/contracts";
import {
  formatBytes,
  resolveReceiptContentType,
  uploadReceiptFile,
  validateReceiptFile,
  type UploadStage,
} from "./receipt-upload";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222";
const UPLOADER_ID = "33333333-3333-4333-8333-333333333333";

const makeReceipt = (status: Receipt["status"]): Receipt => ({
  id: RECEIPT_ID,
  groupId: GROUP_ID,
  status,
  contentType: "image/jpeg",
  sizeBytes: 12,
  uploadedBy: UPLOADER_ID,
  imageUrl: null,
  thumbnailUrl: null,
  ocr: null,
  error: null,
  createdAt: "2026-11-13T18:00:00.000Z",
  updatedAt: "2026-11-13T18:00:00.000Z",
});

describe("validateReceiptFile", () => {
  it("accepts JPEG, PNG, and WebP within the size limit", () => {
    expect(validateReceiptFile({ name: "a.jpg", type: "image/jpeg", size: 1024 })).toEqual({
      ok: true,
      contentType: "image/jpeg",
    });
    expect(validateReceiptFile({ name: "a.png", type: "image/png", size: 1024 })).toEqual({
      ok: true,
      contentType: "image/png",
    });
    expect(validateReceiptFile({ name: "a.webp", type: "image/webp", size: 1024 })).toEqual({
      ok: true,
      contentType: "image/webp",
    });
  });

  it("falls back to extension when the browser omits MIME type", () => {
    expect(resolveReceiptContentType({ name: "IMG_001.JPG", type: "" })).toBe("image/jpeg");
    expect(resolveReceiptContentType({ name: "scan.webp", type: "" })).toBe("image/webp");
    expect(resolveReceiptContentType({ name: "scan.heic", type: "" })).toBeNull();
  });

  it("rejects unsupported types, empty files, and oversized files", () => {
    expect(validateReceiptFile({ name: "doc.pdf", type: "application/pdf", size: 100 })).toEqual({
      ok: false,
      error: "Please choose a JPEG, PNG, or WebP photo.",
    });
    expect(validateReceiptFile({ name: "empty.jpg", type: "image/jpeg", size: 0 })).toEqual({
      ok: false,
      error: "That file is empty.",
    });
    expect(
      validateReceiptFile({ name: "huge.jpg", type: "image/jpeg", size: RECEIPT_MAX_BYTES + 1 }),
    ).toEqual({
      ok: false,
      error: "Receipts must be at most 10 MB.",
    });
  });
});

describe("uploadReceiptFile", () => {
  it("creates the upload, PUTs the file with returned headers, then calls complete", async () => {
    const file = new File(["receiptbytes"], "dinner.jpg", { type: "image/jpeg" });
    const stages: UploadStage[] = [];

    const request = vi.fn(async (path: string, _schema: unknown, init?: { method?: string }) => {
      if (path === `/groups/${GROUP_ID}/receipts`) {
        return {
          receipt: makeReceipt("awaiting_upload"),
          upload: {
            url: "http://localhost:9000/billsplit-receipts/receipts/g/r/original?sig=1",
            method: "PUT" as const,
            headers: { "content-type": "image/jpeg", "content-length": String(file.size) },
            expiresAt: "2026-11-13T18:10:00.000Z",
          },
        };
      }
      expect(path).toBe(`/groups/${GROUP_ID}/receipts/${RECEIPT_ID}/complete`);
      expect(init?.method).toBe("POST");
      return makeReceipt("uploaded");
    });

    const putFetch = vi.fn(async () => new Response(null, { status: 200 }));

    const result = await uploadReceiptFile(GROUP_ID, file, {
      request: request as never,
      putFetch: putFetch as never,
      onStageChange: (s) => stages.push(s),
    });

    expect(result.status).toBe("uploaded");
    expect(stages).toEqual(["starting", "uploading", "confirming"]);
    expect(request).toHaveBeenNthCalledWith(1, `/groups/${GROUP_ID}/receipts`, expect.anything(), {
      body: { contentType: "image/jpeg", sizeBytes: file.size },
    });
    expect(putFetch).toHaveBeenCalledWith(
      "http://localhost:9000/billsplit-receipts/receipts/g/r/original?sig=1",
      {
        method: "PUT",
        headers: { "content-type": "image/jpeg", "content-length": String(file.size) },
        body: file,
      },
    );
  });

  it("does not call complete when the storage PUT fails", async () => {
    const file = new File(["receiptbytes"], "dinner.jpg", { type: "image/jpeg" });
    const request = vi.fn(async () => ({
      receipt: makeReceipt("awaiting_upload"),
      upload: {
        url: "http://localhost:9000/put",
        method: "PUT" as const,
        headers: { "content-type": "image/jpeg", "content-length": String(file.size) },
        expiresAt: "2026-11-13T18:10:00.000Z",
      },
    }));
    const putFetch = vi.fn(async () => new Response("Forbidden", { status: 403 }));

    await expect(
      uploadReceiptFile(GROUP_ID, file, {
        request: request as never,
        putFetch: putFetch as never,
      }),
    ).rejects.toThrow(/403/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("surfaces a clear message when storage cannot be reached", async () => {
    const file = new File(["receiptbytes"], "dinner.jpg", { type: "image/jpeg" });
    const request = vi.fn(async () => ({
      receipt: makeReceipt("awaiting_upload"),
      upload: {
        url: "http://localhost:9000/put",
        method: "PUT" as const,
        headers: { "content-type": "image/jpeg", "content-length": String(file.size) },
        expiresAt: "2026-11-13T18:10:00.000Z",
      },
    }));
    const putFetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(
      uploadReceiptFile(GROUP_ID, file, {
        request: request as never,
        putFetch: putFetch as never,
      }),
    ).rejects.toThrow(/Could not upload the photo to storage/);
  });
});

describe("formatBytes", () => {
  it("formats B, KB, and MB cleanly", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });
});
