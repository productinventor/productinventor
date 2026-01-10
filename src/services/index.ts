/**
 * Services Index - Export all service classes
 *
 * Business logic services for the Slack file checkout system.
 */

// Core services (required for the task)
export { LockService } from './lock.service.js';
export { FileService } from './file.service.js';
export { ProjectService } from './project.service.js';
export { AccessService } from './access.service.js';
export { UserService } from './user.service.js';

// Storage services
export { StorageService } from './storage.service.js';
export type { StoreResult } from './storage.service.js';
export { EncryptedStorageService } from './encrypted-storage.service.js';
export type { EncryptedStoreResult } from './encrypted-storage.service.js';

// Security services
export { KeyManagementService } from './key-management.service.js';
export { SecureDeletionService, DeletionError } from './deletion.service.js';
export type { ProjectDeletionReport, DeletionCertificate } from './deletion.service.js';

// Audit and download services
export { AuditService } from './audit.service.js';
export type {
  AuditEvent,
  RequestMetadata,
  FileAccessHistoryOptions,
  DateRange,
  ComplianceReport,
} from './audit.service.js';
export { DownloadService, DownloadTokenError, FileNotFoundError as DownloadFileNotFoundError } from './download.service.js';
export type { DownloadToken, DownloadResult, RedisClient } from './download.service.js';

// Supporting services
export { HubService } from './hub.service.js';
export { ReferenceService } from './reference.service.js';
