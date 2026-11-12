import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "./env.js";

export interface PresignedPut {
  url: string;
  /** Headers the PUT must carry exactly; they are part of the signature. */
  headers: Record<string, string>;
}

export interface StoredObject {
  sizeBytes: number;
  contentType: string | undefined;
}

/** Private receipt images. Browsers only ever see short-lived signed URLs. */
export interface ReceiptStorage {
  presignPut(
    key: string,
    file: { contentType: string; sizeBytes: number },
    expiresInSeconds: number,
  ): Promise<PresignedPut>;
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
  /** Size and type of a stored object, or null if nothing is there. */
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

/** Keeps objects in memory; tests put bytes in as the browser would. */
export class InMemoryReceiptStorage implements ReceiptStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  put(key: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(key, { bytes, contentType });
  }

  presignPut(key: string, file: { contentType: string; sizeBytes: number }): Promise<PresignedPut> {
    return Promise.resolve({
      url: `http://storage.test/${key}?signed=put`,
      headers: { "content-type": file.contentType, "content-length": String(file.sizeBytes) },
    });
  }

  presignGet(key: string): Promise<string> {
    return Promise.resolve(`http://storage.test/${key}?signed=get`);
  }

  head(key: string): Promise<StoredObject | null> {
    const o = this.objects.get(key);
    return Promise.resolve(
      o ? { sizeBytes: o.bytes.byteLength, contentType: o.contentType } : null,
    );
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

/**
 * S3 (RustFS locally). Two clients because a signed URL embeds its host: `client` talks to the
 * endpoint the API can reach, `signer` signs for the endpoint the browser can reach. In AWS
 * both are the regional endpoint and credentials come from the instance role.
 */
export class S3ReceiptStorage implements ReceiptStorage {
  constructor(
    private readonly client: S3Client,
    private readonly signer: S3Client,
    private readonly bucket: string,
  ) {}

  async presignPut(
    key: string,
    file: { contentType: string; sizeBytes: number },
    expiresInSeconds: number,
  ): Promise<PresignedPut> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: file.contentType,
      ContentLength: file.sizeBytes,
    });
    // Signing content-length makes S3 reject a body of any other size, so the 10 MB limit is
    // enforced by storage and not only by the declared size.
    const url = await getSignedUrl(this.signer, command, {
      expiresIn: expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return {
      url,
      headers: { "content-type": file.contentType, "content-length": String(file.sizeBytes) },
    };
  }

  presignGet(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Null when no bucket is configured: receipt endpoints then answer 503. */
export function createReceiptStorage(env: Env): ReceiptStorage | null {
  if (!env.RECEIPTS_BUCKET) return null;
  const base: S3ClientConfig = {
    region: env.AWS_REGION ?? "us-east-1",
    forcePathStyle: env.S3_FORCE_PATH_STYLE ?? Boolean(env.S3_ENDPOINT),
    // Browsers cannot compute the SDK's default CRC32 checksum header for a presigned PUT.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(env.S3_ACCESS_KEY && env.S3_SECRET_KEY
      ? { credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } }
      : {}),
  };
  const client = new S3Client({
    ...base,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  });
  const publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
  const signer = new S3Client({ ...base, ...(publicEndpoint ? { endpoint: publicEndpoint } : {}) });
  return new S3ReceiptStorage(client, signer, env.RECEIPTS_BUCKET);
}
