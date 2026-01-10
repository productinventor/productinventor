import * as crypto from 'crypto';
import { createReadStream, ReadStream } from 'fs';
import { PrismaClient } from '@prisma/client';
import { AuditService, RequestMetadata } from './audit.service';

/**
 * Represents a download token stored in Redis.
 */
export interface DownloadToken {
  token: string;
  userId: string;
  fileId: string;
  versionNumber: number;
  projectId: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

/**
 * Result of a successful download operation.
 */
export interface DownloadResult {
  stream: ReadStream;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
}

/**
 * Redis client interface for token storage.
 * Compatible with ioredis and node-redis.
 */
export interface RedisClient {
  setex(key: string, seconds: number, value: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

/**
 * Storage service interface for retrieving file paths.
 */
export interface StorageService {
  getPath(contentHash: string): string;
  exists(contentHash: string): Promise<boolean>;
}

/**
 * Error thrown when a download token is invalid or expired.
 */
export class DownloadTokenError extends Error {
  constructor(
    message: string,
    public readonly code: 'EXPIRED' | 'INVALID' | 'USER_MISMATCH' | 'ALREADY_USED'
  ) {
    super(message);
    this.name = 'DownloadTokenError';
  }
}

/**
 * Error thrown when a file is not found.
 */
export class FileNotFoundError extends Error {
  constructor(message: string = 'File not found') {
    super(message);
    this.name = 'FileNotFoundError';
  }
}

/**
 * Download service providing tracked downloads with single-use tokens.
 *
 * Features:
 * - Secure token generation using crypto.randomBytes
 * - Single-use tokens to prevent replay attacks
 * - Configurable token expiry (default 5 minutes)
 * - Full audit logging of all download attempts
 * - User verification to prevent token theft
 */
export class DownloadService {
  /**
   * Token expiry time in seconds (5 minutes).
   */
  public static readonly TOKEN_EXPIRY_SECONDS = 300;

  constructor(
    private prisma: PrismaClient,
    private storage: StorageService,
    private audit: AuditService,
    private redis: RedisClient
  ) {}

  /**
   * Generate a secure, single-use download token.
   *
   * The token is stored in Redis with automatic expiry and includes
   * all information needed to validate and execute the download.
   *
   * @param userId - The user requesting the download
   * @param fileId - The file to download
   * @param versionNumber - The specific version to download (optional, defaults to current)
   * @returns The generated token string
   * @throws FileNotFoundError if the file or version doesn't exist
   */
  async createDownloadToken(
    userId: string,
    fileId: string,
    versionNumber?: number
  ): Promise<string> {
    // Get file with project and version information
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        project: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
        },
      },
    });

    if (!file) {
      throw new FileNotFoundError(`File not found: ${fileId}`);
    }

    // Determine which version to download
    const targetVersion = versionNumber ?? file.currentVersion;
    const version = file.versions.find((v) => v.versionNumber === targetVersion);

    if (!version) {
      throw new FileNotFoundError(
        `Version ${targetVersion} not found for file: ${fileId}`
      );
    }

    // Generate secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    const tokenData: DownloadToken = {
      token,
      userId,
      fileId,
      versionNumber: targetVersion,
      projectId: file.projectId,
      fileName: file.name,
      mimeType: file.mimeType,
      contentHash: version.contentHash,
      createdAt: now,
      expiresAt: now + DownloadService.TOKEN_EXPIRY_SECONDS * 1000,
      used: false,
    };

    // Store token in Redis with automatic expiry
    await this.redis.setex(
      this.getTokenKey(token),
      DownloadService.TOKEN_EXPIRY_SECONDS,
      JSON.stringify(tokenData)
    );

    // Log token creation
    await this.audit.log({
      eventType: 'DOWNLOAD_TOKEN_CREATED',
      outcome: 'SUCCESS',
      userId,
      fileId,
      projectId: file.projectId,
      details: {
        versionNumber: targetVersion,
        expiresIn: DownloadService.TOKEN_EXPIRY_SECONDS,
        tokenPrefix: token.substring(0, 8),
      },
    });

    return token;
  }

  /**
   * Validate and consume a download token (single-use).
   *
   * This method verifies:
   * - Token exists and hasn't expired
   * - Token hasn't been used before
   * - Requesting user matches token owner
   *
   * @param token - The token to validate and consume
   * @param requestUserId - The user attempting to use the token
   * @param request - Request metadata for audit logging
   * @returns The validated token data
   * @throws DownloadTokenError if validation fails
   */
  async consumeToken(
    token: string,
    requestUserId: string,
    request: RequestMetadata
  ): Promise<DownloadToken> {
    const key = this.getTokenKey(token);
    const data = await this.redis.get(key);

    // Token not found (expired or invalid)
    if (!data) {
      await this.audit.log({
        eventType: 'DOWNLOAD_TOKEN_EXPIRED',
        outcome: 'DENIED',
        userId: requestUserId,
        ipAddress: request.ip,
        userAgent: request.userAgent,
        details: { tokenPrefix: token.substring(0, 8) + '...' },
      });

      throw new DownloadTokenError(
        'Download token has expired or is invalid',
        'EXPIRED'
      );
    }

    const tokenData: DownloadToken = JSON.parse(data);

    // Check if token was already used (shouldn't happen with Redis delete, but safety check)
    if (tokenData.used) {
      await this.audit.log({
        eventType: 'DOWNLOAD_TOKEN_EXPIRED',
        outcome: 'DENIED',
        userId: requestUserId,
        fileId: tokenData.fileId,
        projectId: tokenData.projectId,
        ipAddress: request.ip,
        userAgent: request.userAgent,
        details: { reason: 'Token already used' },
      });

      throw new DownloadTokenError(
        'Download token has already been used',
        'ALREADY_USED'
      );
    }

    // Verify the requesting user matches the token owner
    if (tokenData.userId !== requestUserId) {
      await this.audit.logAccessDenied(
        requestUserId,
        tokenData.projectId,
        'Download token user mismatch',
        request
      );

      throw new DownloadTokenError(
        'Download token does not belong to this user',
        'USER_MISMATCH'
      );
    }

    // Consume the token by deleting from Redis (single-use)
    await this.redis.del(key);

    // Log successful token consumption
    await this.audit.log({
      eventType: 'DOWNLOAD_TOKEN_USED',
      outcome: 'SUCCESS',
      userId: requestUserId,
      fileId: tokenData.fileId,
      projectId: tokenData.projectId,
      ipAddress: request.ip,
      userAgent: request.userAgent,
      details: { versionNumber: tokenData.versionNumber },
    });

    return tokenData;
  }

  /**
   * Execute a tracked download using a token.
   *
   * This method:
   * 1. Validates and consumes the token
   * 2. Retrieves the file from storage
   * 3. Creates an audit log entry
   * 4. Returns a readable stream for the file
   *
   * @param token - The download token
   * @param requestUserId - The user requesting the download
   * @param request - Request metadata for audit logging
   * @returns Download result with stream, filename, and metadata
   * @throws DownloadTokenError if token validation fails
   * @throws FileNotFoundError if the file content is missing
   */
  async download(
    token: string,
    requestUserId: string,
    request: RequestMetadata
  ): Promise<DownloadResult> {
    // Validate and consume the token
    const tokenData = await this.consumeToken(token, requestUserId, request);

    // Get the file path from storage
    const filePath = this.storage.getPath(tokenData.contentHash);

    // Verify file exists in storage
    const exists = await this.storage.exists(tokenData.contentHash);
    if (!exists) {
      await this.audit.log({
        eventType: 'FILE_DOWNLOAD',
        outcome: 'FAILURE',
        userId: requestUserId,
        fileId: tokenData.fileId,
        projectId: tokenData.projectId,
        ipAddress: request.ip,
        userAgent: request.userAgent,
        details: {
          error: 'File content not found in storage',
          contentHash: tokenData.contentHash,
        },
      });

      throw new FileNotFoundError('File content not found in storage');
    }

    // Get file size from database
    const version = await this.prisma.fileVersion.findFirst({
      where: {
        fileId: tokenData.fileId,
        versionNumber: tokenData.versionNumber,
      },
    });

    // Log the actual download
    await this.audit.logFileDownload(
      requestUserId,
      tokenData.fileId,
      tokenData.versionNumber,
      request
    );

    // Create and return the read stream
    return {
      stream: createReadStream(filePath),
      filename: tokenData.fileName,
      mimeType: tokenData.mimeType,
      sizeBytes: version?.sizeBytes ?? BigInt(0),
    };
  }

  /**
   * Create a download URL with an embedded token.
   *
   * @param token - The download token
   * @param baseUrl - The base URL for downloads
   * @returns The full download URL
   */
  createDownloadUrl(token: string, baseUrl: string): string {
    return `${baseUrl}/api/download/${token}`;
  }

  /**
   * Check if a token is still valid without consuming it.
   *
   * @param token - The token to check
   * @returns True if the token is valid, false otherwise
   */
  async isTokenValid(token: string): Promise<boolean> {
    const data = await this.redis.get(this.getTokenKey(token));
    if (!data) {
      return false;
    }

    const tokenData: DownloadToken = JSON.parse(data);
    return !tokenData.used && tokenData.expiresAt > Date.now();
  }

  /**
   * Get token information without consuming it.
   *
   * @param token - The token to query
   * @returns Token data if valid, null otherwise
   */
  async getTokenInfo(token: string): Promise<DownloadToken | null> {
    const data = await this.redis.get(this.getTokenKey(token));
    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * Revoke a download token before it expires.
   *
   * @param token - The token to revoke
   * @param userId - The user revoking the token
   * @returns True if token was revoked, false if it didn't exist
   */
  async revokeToken(token: string, userId: string): Promise<boolean> {
    const key = this.getTokenKey(token);
    const data = await this.redis.get(key);

    if (!data) {
      return false;
    }

    const tokenData: DownloadToken = JSON.parse(data);

    // Only token owner can revoke
    if (tokenData.userId !== userId) {
      return false;
    }

    await this.redis.del(key);

    await this.audit.log({
      eventType: 'DOWNLOAD_TOKEN_EXPIRED',
      outcome: 'SUCCESS',
      userId,
      fileId: tokenData.fileId,
      projectId: tokenData.projectId,
      details: { reason: 'Token revoked by user' },
    });

    return true;
  }

  /**
   * Get the Redis key for a token.
   *
   * @param token - The token value
   * @returns The Redis key
   */
  private getTokenKey(token: string): string {
    return `download:${token}`;
  }
}
