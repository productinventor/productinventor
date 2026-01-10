/**
 * Bolt App Configuration
 *
 * Initializes the Slack Bolt application with socket mode,
 * sets up database connections, and initializes all services
 * with their dependencies.
 */

import { App } from '@slack/bolt';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { config } from './config/index.js';

// Import all services
import { KeyManagementService } from './services/key-management.service.js';
import { StorageService } from './services/storage.service.js';
import { EncryptedStorageService } from './services/encrypted-storage.service.js';
import { AuditService } from './services/audit.service.js';
import { DownloadService } from './services/download.service.js';
import type { RedisClient, StorageService as DownloadStorageService } from './services/download.service.js';
import { SecureDeletionService } from './services/deletion.service.js';
import { LockService } from './services/lock.service.js';
import { UserService } from './services/user.service.js';
import { ProjectService } from './services/project.service.js';
import { AccessService } from './services/access.service.js';
import { HubService } from './services/hub.service.js';
import { ReferenceService } from './services/reference.service.js';
import { FileService } from './services/file.service.js';

// =============================================================================
// Initialize Bolt App
// =============================================================================

/**
 * The Slack Bolt application instance.
 * Configured with socket mode for real-time events.
 */
export const app = new App({
  token: config.slack.botToken,
  signingSecret: config.slack.signingSecret,
  appToken: config.slack.appToken,
  socketMode: true,
});

// =============================================================================
// Initialize Database Clients
// =============================================================================

/**
 * The Prisma client for database operations.
 */
export const prisma = new PrismaClient({
  log: config.app.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

/**
 * The Redis client for caching and token storage.
 */
export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number): number {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
});

// Create a Redis client adapter that conforms to the DownloadService interface
const redisClientAdapter: RedisClient = {
  async setex(key: string, seconds: number, value: string): Promise<string | null> {
    return redis.setex(key, seconds, value);
  },
  async get(key: string): Promise<string | null> {
    return redis.get(key);
  },
  async del(key: string): Promise<number> {
    return redis.del(key);
  },
};

// =============================================================================
// Initialize Services
// =============================================================================

/**
 * Key Management Service for encryption key derivation.
 */
export const keyManagementService = new KeyManagementService(
  prisma,
  config.encryption.masterKey
);

/**
 * Base Storage Service for content-addressed file storage.
 * Always initialized for basic storage operations.
 */
export const storageService = new StorageService(config.storage.path);

/**
 * Encrypted Storage Service (used when encryption mode is 'encrypted').
 */
export const encryptedStorageService = new EncryptedStorageService(
  config.storage.path,
  keyManagementService
);

/**
 * Active storage service - the one to use based on encryption mode.
 * For encrypted mode, use encryptedStorageService directly with projectId.
 * For standard mode, use storageService.
 */
export const activeStorageMode = config.encryption.mode;

/**
 * Audit Service for comprehensive audit logging.
 */
export const auditService = new AuditService(prisma);

/**
 * Storage adapter that conforms to DownloadService's StorageService interface.
 * Uses the base storageService for path resolution and existence checks.
 */
const downloadStorageAdapter: DownloadStorageService = {
  getPath: (contentHash: string) => storageService.getPath(contentHash),
  exists: (contentHash: string) => storageService.exists(contentHash),
};

/**
 * Download Service for tracked file downloads with single-use tokens.
 */
export const downloadService = new DownloadService(
  prisma,
  downloadStorageAdapter,
  auditService,
  redisClientAdapter
);

/**
 * Secure Deletion Service for DoD 5220.22-M compliant file deletion.
 */
export const secureDeletionService = new SecureDeletionService(
  prisma,
  downloadStorageAdapter,
  auditService
);

/**
 * Lock Service for file checkout/locking.
 */
export const lockService = new LockService(prisma);

/**
 * User Service for Slack user mapping.
 */
export const userService = new UserService(prisma);

/**
 * Project Service for project/hub management.
 */
export const projectService = new ProjectService(prisma, app.client);

/**
 * Access Service for channel-based access control.
 */
export const accessService = new AccessService(app.client);

/**
 * Hub Service for file hub message management.
 */
export const hubService = new HubService(prisma, app.client);

/**
 * Reference Service for reference card management.
 */
export const referenceService = new ReferenceService(prisma, app.client);

/**
 * File Service for core file operations.
 */
export const fileService = new FileService(
  prisma,
  storageService,
  lockService,
  hubService,
  referenceService
);

// =============================================================================
// Service Container
// =============================================================================

/**
 * Container object with all initialized services.
 * Useful for dependency injection in listeners and handlers.
 */
export const services = {
  keyManagement: keyManagementService,
  storage: storageService,
  encryptedStorage: encryptedStorageService,
  audit: auditService,
  download: downloadService,
  secureDeletion: secureDeletionService,
  lock: lockService,
  user: userService,
  project: projectService,
  access: accessService,
  hub: hubService,
  reference: referenceService,
  file: fileService,
} as const;

/**
 * Type for the services container.
 */
export type Services = typeof services;

// =============================================================================
// Graceful Shutdown
// =============================================================================

/**
 * Disconnect all clients gracefully.
 * Call this during application shutdown.
 */
export async function disconnectClients(): Promise<void> {
  console.log('Disconnecting database and Redis clients...');

  try {
    await prisma.$disconnect();
    console.log('Prisma client disconnected');
  } catch (error) {
    console.error('Error disconnecting Prisma:', error);
  }

  try {
    await redis.quit();
    console.log('Redis client disconnected');
  } catch (error) {
    console.error('Error disconnecting Redis:', error);
  }
}

/**
 * Connect to Redis.
 * Call this during application startup.
 */
export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
    console.log('Redis client connected');
  } catch (error) {
    // Redis might already be connected via lazy connect
    if ((error as Error).message?.includes('already')) {
      console.log('Redis client already connected');
    } else {
      throw error;
    }
  }
}

export default app;
