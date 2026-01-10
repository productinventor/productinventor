import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { StorageService, StoreResult } from './storage.service';
import { KeyManagementService } from './key-management.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptedStoreResult extends StoreResult {
  encrypted: true;
}

export class EncryptedStorageService extends StorageService {
  private readonly keyManagementService: KeyManagementService;

  constructor(basePath: string, keyManagementService: KeyManagementService) {
    super(basePath);
    this.keyManagementService = keyManagementService;
  }

  /**
   * Store a file with AES-256-GCM encryption.
   *
   * The stored file format is:
   * [16-byte IV][encrypted content][16-byte auth tag]
   *
   * @param filePath - Path to the source file to encrypt and store
   * @param projectId - Project ID used to derive the encryption key
   * @returns Hash and size of the encrypted content
   */
  async store(filePath: string, projectId: string): Promise<EncryptedStoreResult> {
    // Read the plaintext content
    const plaintext = await readFile(filePath);

    // Get the project-specific encryption key
    const key = this.keyManagementService.getProjectKey(projectId);
    this.validateKeyLength(key);

    // Generate a random IV
    const iv = randomBytes(IV_LENGTH);

    // Create cipher and encrypt
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    // Combine: IV + encrypted content + auth tag
    const encryptedContent = Buffer.concat([iv, encrypted, authTag]);

    // Write to a temporary file for hashing and storage
    const tempPath = `${filePath}.encrypted.tmp`;
    await writeFile(tempPath, encryptedContent);

    try {
      // Use parent class to store the encrypted content
      const result = await super.store(tempPath);

      return {
        ...result,
        encrypted: true
      };
    } finally {
      // Clean up temporary file
      try {
        const { unlink } = await import('fs/promises');
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Retrieve and decrypt a file from storage.
   *
   * Extracts the IV and auth tag from the stored content,
   * then decrypts using the project-specific key.
   *
   * @param hash - Content hash of the encrypted file
   * @param projectId - Project ID used to derive the decryption key
   * @returns Decrypted content as a Buffer
   */
  async retrieve(hash: string, projectId: string): Promise<Buffer> {
    const storagePath = this.getPath(hash);

    // Read the encrypted content
    const encryptedContent = await readFile(storagePath);

    // Validate minimum length (IV + auth tag + at least 1 byte of data)
    const minLength = IV_LENGTH + AUTH_TAG_LENGTH + 1;
    if (encryptedContent.length < minLength) {
      throw new Error('Invalid encrypted content: too short');
    }

    // Extract components: [IV][encrypted data][auth tag]
    const iv = encryptedContent.subarray(0, IV_LENGTH);
    const authTag = encryptedContent.subarray(encryptedContent.length - AUTH_TAG_LENGTH);
    const encrypted = encryptedContent.subarray(IV_LENGTH, encryptedContent.length - AUTH_TAG_LENGTH);

    // Get the project-specific decryption key
    const key = this.keyManagementService.getProjectKey(projectId);
    this.validateKeyLength(key);

    // Create decipher and decrypt
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);
      return decrypted;
    } catch (error) {
      throw new Error('Decryption failed: authentication tag mismatch or corrupted data');
    }
  }

  /**
   * Validate that the key has the correct length for AES-256.
   */
  private validateKeyLength(key: Buffer): void {
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Invalid key length: expected ${KEY_LENGTH} bytes, got ${key.length} bytes`);
    }
  }
}
