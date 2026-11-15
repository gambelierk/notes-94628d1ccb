import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export class TooLargeError extends Error {}

export interface StoredBlob {
  key: string;
  sha256: string;
  size: number;
  /** First bytes of the file, for format sniffing. */
  head: Uint8Array;
}

/**
 * Content-addressed file storage. Keys are SHA-256 hashes, so identical
 * uploads are stored once and file names never come from user input.
 * Replace with S3/R2 by implementing the same interface.
 */
export interface BlobStore {
  put(bytes: Uint8Array): Promise<StoredBlob>;
  /** Stream an upload to storage without holding it in memory. */
  putStream(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<StoredBlob>;
  get(key: string): Promise<Uint8Array | null>;
  size(key: string): Promise<number | null>;
  /** Byte range [start, end] inclusive. */
  stream(key: string, start?: number, end?: number): ReadableStream<Uint8Array>;
  delete(key: string): Promise<void>;
}

/** Enough to recognise formats that start with text (an SVG's XML prolog and comments). */
const HEAD_BYTES = 4096;

export class DiskBlobStore implements BlobStore {
  private readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private file(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Ogiltig nyckel');
    return path.join(this.dir, key.slice(0, 2), key);
  }

  private tmpFile() {
    return path.join(this.dir, 'tmp', `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  private async commit(tmp: string, sha256: string): Promise<void> {
    const target = this.file(sha256);
    try {
      await stat(target);
      await rm(tmp, { force: true }); // already stored (dedupe)
    } catch {
      await mkdir(path.dirname(target), { recursive: true });
      await rename(tmp, target);
    }
  }

  async put(bytes: Uint8Array): Promise<StoredBlob> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const tmp = this.tmpFile();
    await mkdir(path.dirname(tmp), { recursive: true });
    await writeFile(tmp, bytes);
    await this.commit(tmp, sha256);
    return { key: sha256, sha256, size: bytes.byteLength, head: bytes.slice(0, HEAD_BYTES) };
  }

  async putStream(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<StoredBlob> {
    const tmp = this.tmpFile();
    await mkdir(path.dirname(tmp), { recursive: true });
    const hash = createHash('sha256');
    const out = createWriteStream(tmp);
    let size = 0;
    let head = new Uint8Array(0);
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new TooLargeError();
        if (head.byteLength < HEAD_BYTES) {
          const h = new Uint8Array(Math.min(HEAD_BYTES, head.byteLength + value.byteLength));
          h.set(head);
          h.set(value.subarray(0, h.byteLength - head.byteLength), head.byteLength);
          head = h;
        }
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      }
      await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
    } catch (e) {
      reader.cancel().catch(() => undefined);
      out.destroy();
      await rm(tmp, { force: true });
      throw e;
    }
    const sha256 = hash.digest('hex');
    await this.commit(tmp, sha256);
    return { key: sha256, sha256, size, head };
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.file(key)));
    } catch {
      return null;
    }
  }

  async size(key: string) {
    try {
      return (await stat(this.file(key))).size;
    } catch {
      return null;
    }
  }

  stream(key: string, start?: number, end?: number): ReadableStream<Uint8Array> {
    return Readable.toWeb(createReadStream(this.file(key), { start, end })) as ReadableStream<Uint8Array>;
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}
