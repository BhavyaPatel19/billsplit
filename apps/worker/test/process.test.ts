import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import pino from "pino";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations, schema, type DbHandle } from "@billsplit/db";
import { InMemoryReceiptStorage, receiptKeys } from "@billsplit/storage";
import { ReceiptOcrSchema } from "@billsplit/contracts";
import { FixtureOcrProvider, OcrRefusalError, type OcrProvider } from "@billsplit/ocr";
import { processReceipt, type ProcessDeps } from "../src/process.js";

let container: StartedPostgreSqlContainer;
let handle: DbHandle;
let groupId = "";
let uploaderId = "";
const storage = new InMemoryReceiptStorage();
let deps: ProcessDeps;

const photo = () =>
  sharp({ create: { width: 1200, height: 900, channels: 3, background: "#eee" } })
    .jpeg()
    .withExif({ IFD0: { ImageDescription: "kitchen table" } })
    .toBuffer();

async function receipt(
  status: (typeof schema.receipts.$inferInsert)["status"],
  bytes?: Uint8Array,
) {
  const id = crypto.randomUUID();
  const keys = receiptKeys(groupId, id);
  await handle.db.insert(schema.receipts).values({
    id,
    groupId,
    uploadedBy: uploaderId,
    status,
    contentType: "image/jpeg",
    sizeBytes: bytes?.byteLength ?? 1,
    originalKey: keys.original,
  });
  if (bytes) await storage.put(keys.original, bytes, "image/jpeg");
  return { id, keys };
}

const row = async (id: string) =>
  (await handle.db.select().from(schema.receipts).where(eq(schema.receipts.id, id)))[0]!;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  await runMigrations(container.getConnectionUri());
  handle = createDb({ connectionString: container.getConnectionUri(), max: 2 });
  const [group] = await handle.db
    .insert(schema.groups)
    .values({ name: "Flat 4B" })
    .returning({ id: schema.groups.id });
  groupId = group!.id;
  const [p] = await handle.db
    .insert(schema.participants)
    .values({ groupId, displayName: "Ana" })
    .returning({ id: schema.participants.id });
  uploaderId = p!.id;
  deps = {
    db: handle.db,
    storage,
    ocr: new FixtureOcrProvider({ costMicroUsd: 4200 }),
    logger: pino({ enabled: false }),
  };
});

afterAll(async () => {
  await handle?.close();
  await container?.stop();
});

describe("processReceipt", () => {
  it("stores a clean image and thumbnail, deletes the original and marks the receipt ready", async () => {
    const { id, keys } = await receipt("uploaded", await photo());
    expect(await processReceipt(deps, id)).toBe("ready");

    const r = await row(id);
    expect(r.status).toBe("ready");
    expect(r.imageKey).toBe(keys.image);
    expect(r.thumbnailKey).toBe(keys.thumbnail);
    expect(r.error).toBeNull();
    expect(r.ocrCostMicroUsd).toBe(4200);
    const parsedOcr = ReceiptOcrSchema.parse(r.ocr);
    expect(parsedOcr.reconciliation.matches).toBe(true);
    expect(parsedOcr.items.length).toBeGreaterThan(0);

    expect(storage.objects.has(keys.original)).toBe(false);
    const image = storage.objects.get(keys.image)!;
    expect(image.contentType).toBe("image/jpeg");
    expect((await sharp(image.bytes).metadata()).exif).toBeUndefined();
    expect(Buffer.from(image.bytes).toString("latin1")).not.toContain("kitchen table");
    expect(storage.objects.get(keys.thumbnail)!.bytes.byteLength).toBeLessThan(
      image.bytes.byteLength,
    );
  });

  it("runs again without re-encoding and only cleans up a leftover original", async () => {
    const { id, keys } = await receipt("uploaded", await photo());
    expect(await processReceipt(deps, id)).toBe("ready");
    await storage.put(keys.original, new Uint8Array([1, 2, 3]), "image/jpeg"); // delete had failed
    expect(await processReceipt(deps, id)).toBe("skipped");
    expect(storage.objects.has(keys.original)).toBe(false);
    expect((await row(id)).status).toBe("ready");
  });

  it("fails a file that is not an image, with a reason for the uploader", async () => {
    const { id, keys } = await receipt(
      "uploaded",
      new TextEncoder().encode("%PDF-1.4 not a photo"),
    );
    expect(await processReceipt(deps, id)).toBe("failed");
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/could not be read as an image/);
    expect(r.imageKey).toBeNull();
    expect(storage.objects.has(keys.image)).toBe(false);
  });

  it("fails when the original has gone missing from storage", async () => {
    const { id } = await receipt("uploaded");
    expect(await processReceipt(deps, id)).toBe("failed");
    expect((await row(id)).error).toMatch(/no longer in storage/);
  });

  it("retries a receipt left in processing by a crashed attempt", async () => {
    const { id } = await receipt("processing", await photo());
    expect(await processReceipt(deps, id)).toBe("ready");
  });

  it("leaves receipts that are not awaiting processing alone", async () => {
    const { id } = await receipt("awaiting_upload");
    expect(await processReceipt(deps, id)).toBe("skipped");
    expect((await row(id)).status).toBe("awaiting_upload");
    expect(await processReceipt(deps, crypto.randomUUID())).toBe("skipped");
  });

  it("marks receipt needs_review when OCR line items do not reconcile with the total", async () => {
    const { id, keys } = await receipt("uploaded", await photo());
    const mismatchOcr = new FixtureOcrProvider({
      extraction: {
        merchant: "Corner Bistro",
        date: "2026-11-12",
        currency: "USD",
        items: [
          {
            description: "Pasta",
            quantity: 1,
            unitPriceCents: 1500,
            totalPriceCents: 1500,
            confidence: "high",
          },
        ],
        subtotalCents: 1500,
        taxCents: 150,
        tipCents: null,
        feeCents: null,
        discountCents: null,
        totalCents: 1900,
      },
    });
    expect(await processReceipt({ ...deps, ocr: mismatchOcr }, id)).toBe("needs_review");

    const r = await row(id);
    expect(r.status).toBe("needs_review");
    expect(storage.objects.has(keys.original)).toBe(false);
    const parsedOcr = ReceiptOcrSchema.parse(r.ocr);
    expect(parsedOcr.reconciliation.matches).toBe(false);
    expect(parsedOcr.reconciliation.discrepancyCents).toBe(250);
  });

  it("marks receipt failed without throwing when the OCR model refuses the image", async () => {
    const { id } = await receipt("uploaded", await photo());
    const refusingOcr: OcrProvider = {
      name: "claude",
      extract: () =>
        Promise.reject(
          new OcrRefusalError("Refused", { category: "other", explanation: "Policy violation" }),
        ),
    };
    expect(await processReceipt({ ...deps, ocr: refusingOcr }, id)).toBe("failed");

    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/cannot be processed as a receipt/);
  });
});
