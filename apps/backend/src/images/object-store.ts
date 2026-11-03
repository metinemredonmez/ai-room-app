import { DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';

// Storage drivers behind one interface (fal-app R2 / palemi S3 pattern). Keys are server-generated
// UUIDs only; callers never pass user input as a key. Buckets stay private: clients still get the
// backend's short-lived signed URL (FIL-04) and the backend streams the object.

export interface ObjectStore {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(keys: string[]): Promise<void>;
  health(): Promise<'ok' | 'down'>;
}

export class LocalStore implements ObjectStore {
  readonly driver = 'local' as const;

  constructor(private dir: string) {}

  private file(key: string) {
    return path.join(this.dir, key);
  }

  async put(key: string, body: Buffer, _contentType?: string) {
    await mkdir(path.dirname(this.file(key)), { recursive: true, mode: 0o700 });
    await writeFile(this.file(key), body, { mode: 0o600 });
  }

  async get(key: string) {
    try {
      return await readFile(this.file(key));
    } catch {
      return null;
    }
  }

  async delete(keys: string[]) {
    await Promise.all(keys.map((k) => rm(this.file(k), { force: true })));
  }

  async health() {
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      return 'ok' as const;
    } catch {
      return 'down' as const;
    }
  }
}

export class S3Store implements ObjectStore {
  readonly driver = 's3' as const;
  private client: S3Client;

  constructor(private bucket: string, private prefix: string, opts: { region: string; endpoint?: string; forcePathStyle: boolean; accessKeyId?: string; secretAccessKey?: string }) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
      maxAttempts: 3,
    });
  }

  private key(k: string) {
    return `${this.prefix}${k}`;
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), Body: body, ContentType: contentType, CacheControl: 'private, max-age=3600' }),
    );
  }

  async get(key: string) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw e;
    }
  }

  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      if (!batch.length) continue;
      await this.client.send(
        new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((k) => ({ Key: this.key(k) })), Quiet: true } }),
      );
    }
  }

  async health() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return 'ok' as const;
    } catch {
      return 'down' as const;
    }
  }
}

export function createObjectStore(cfg: Config, localDir: string): ObjectStore {
  if (cfg.STORAGE_DRIVER === 's3') {
    return new S3Store(cfg.S3_BUCKET!, cfg.S3_PREFIX, {
      region: cfg.S3_REGION,
      endpoint: cfg.S3_ENDPOINT,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      accessKeyId: cfg.S3_ACCESS_KEY_ID,
      secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    });
  }
  return new LocalStore(localDir);
}
