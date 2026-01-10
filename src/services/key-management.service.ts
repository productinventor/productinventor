import { hkdfSync } from 'crypto';
import { PrismaClient } from '@prisma/client';

export class KeyManagementService {
  private readonly prisma: PrismaClient;
  private readonly masterKey: Buffer;

  constructor(prisma: PrismaClient, masterKey: Buffer) {
    if (masterKey.length !== 32) {
      throw new Error('Master key must be exactly 32 bytes');
    }
    this.prisma = prisma;
    this.masterKey = masterKey;
  }

  /**
   * Derive a project-specific encryption key from the master key using HKDF.
   *
   * Uses HKDF (HMAC-based Key Derivation Function) with:
   * - SHA256 as the hash algorithm
   * - Project ID as the salt (ensures unique key per project)
   * - 'file-encryption' as the info string
   * - 32-byte output for AES-256
   */
  getProjectKey(projectId: string): Buffer {
    const salt = Buffer.from(projectId, 'utf-8');
    const info = Buffer.from('file-encryption', 'utf-8');

    const derivedKey = hkdfSync(
      'sha256',
      this.masterKey,
      salt,
      info,
      32 // 32 bytes for AES-256
    );

    return Buffer.from(derivedKey);
  }
}
