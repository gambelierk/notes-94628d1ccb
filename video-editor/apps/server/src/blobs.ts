import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

/**
 * Content-addressed file storage. Keys are SHA-256 hashes, so identical
 * uploads are stored once and names never come from user input.
 * Swap this for S3/R2 by implementing the same interface.
 */
export interface BlobStore {
  put(bytes: Uint8Array): Promise<{ key: string; sha256: string; size: number }>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class DiskBlobStore implements BlobStore {
  private readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private file(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Ogiltig nyckel');
    return path.join(this.dir, key.slice(0, 2), key);
  }

  async put(bytes: Uint8Array) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const target = this.file(sha256);
    try {
      await stat(target);
    } catch {
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, target);
    }
    return { key: sha256, sha256, size: bytes.byteLength };
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.file(key)));
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}
