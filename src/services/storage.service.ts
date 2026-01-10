import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, access, unlink, stat } from 'fs/promises';
import { join, dirname } from 'path';

export interface StoreResult {
  hash: string;
  size: number;
}

export class StorageService {
  protected readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Store a file in content-addressed storage.
   * Files are stored at paths like: basePath/ab/cd/abcdef1234...
   * Deduplication is automatic - if content already exists, just returns the hash.
   */
  async store(filePath: string): Promise<StoreResult> {
    const hash = await this.hashFile(filePath);
    const storagePath = this.getPath(hash);

    // Check if content already exists (deduplication)
    if (await this.exists(hash)) {
      const fileStats = await stat(storagePath);
      return { hash, size: fileStats.size };
    }

    // Read the source file
    const content = await readFile(filePath);

    // Ensure directory structure exists
    await mkdir(dirname(storagePath), { recursive: true });

    // Write content to storage
    await writeFile(storagePath, content);

    return { hash, size: content.length };
  }

  /**
   * Get the filesystem path for a given content hash.
   * Uses a two-level directory structure: ab/cd/abcdef1234...
   */
  getPath(hash: string): string {
    const dir1 = hash.substring(0, 2);
    const dir2 = hash.substring(2, 4);
    return join(this.basePath, dir1, dir2, hash);
  }

  /**
   * Check if content with the given hash exists in storage.
   */
  async exists(hash: string): Promise<boolean> {
    const storagePath = this.getPath(hash);
    try {
      await access(storagePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete content with the given hash from storage.
   */
  async delete(hash: string): Promise<void> {
    const storagePath = this.getPath(hash);
    try {
      await unlink(storagePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Calculate SHA256 hash of a file.
   */
  protected async hashFile(filePath: string): Promise<string> {
    const content = await readFile(filePath);
    const hash = createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
  }
}
