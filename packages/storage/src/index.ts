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
  /** The object's bytes, or null if nothing is there. */
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Keeps objects in memory; tests put bytes in as the browser would. */
export class InMemoryReceiptStorage implements ReceiptStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

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

  get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(key)?.bytes ?? null);
  }

  put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes, contentType });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

/**
 * S3 (RustFS locally). Two clients because a signed URL embeds its host: `client` talks to the
 * endpoint the service can reach, `signer` signs for the endpoint the browser can reach. In AWS
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
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NotFound) return true;
  const name = (err as { name?: string }).name;
  return name === "NotFound" || name === "NoSuchKey";
}

export interface StorageConfig {
  bucket: string;
  region?: string | undefined;
  /** S3-compatible endpoint the service reaches (RustFS locally); unset in AWS. */
  endpoint?: string | undefined;
  /** Endpoint browsers reach, used to sign URLs; defaults to `endpoint`. */
  publicEndpoint?: string | undefined;
  /** Static keys for local S3 only; in AWS the instance role supplies credentials. */
  accessKey?: string | undefined;
  secretKey?: string | undefined;
  /** Path-style URLs (bucket in the path); defaults to on when `endpoint` is set. */
  forcePathStyle?: boolean | undefined;
}

export function createReceiptStorage(cfg: StorageConfig): ReceiptStorage {
  const base: S3ClientConfig = {
    region: cfg.region ?? "us-east-1",
    forcePathStyle: cfg.forcePathStyle ?? Boolean(cfg.endpoint),
    // Browsers cannot compute the SDK's default CRC32 checksum header for a presigned PUT.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    // Reads two env-derived settings; no secret is written here (hence the gitleaks marker).
    ...(cfg.accessKey && cfg.secretKey
      ? { credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } } // gitleaks:allow
      : {}),
  };
  const client = new S3Client({ ...base, ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}) });
  const publicEndpoint = cfg.publicEndpoint ?? cfg.endpoint;
  const signer = new S3Client({ ...base, ...(publicEndpoint ? { endpoint: publicEndpoint } : {}) });
  return new S3ReceiptStorage(client, signer, cfg.bucket);
}

/** Object key layout: everything for one receipt sits under one prefix in its group. */
export const receiptKeys = (groupId: string, receiptId: string) => ({
  original: `receipts/${groupId}/${receiptId}/original`,
  image: `receipts/${groupId}/${receiptId}/image.jpg`,
  thumbnail: `receipts/${groupId}/${receiptId}/thumb.jpg`,
});
