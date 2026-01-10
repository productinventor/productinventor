/**
 * Type definitions for the Slack file checkout system
 */

import type { PrismaClient } from '@prisma/client';

// Re-export Prisma types for convenience
export type {
  User,
  Project,
  File,
  FileVersion,
  FileLock,
  FileReference,
  AuditLog,
  DeletionRecord,
  AuditEventType,
  AuditOutcome,
  DeletionStatus,
} from '@prisma/client';

/**
 * User profile data from Slack
 */
export interface SlackProfile {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

/**
 * Project creation data
 */
export interface CreateProjectData {
  name: string;
  slackTeamId: string;
  hubChannelId: string;
  createdById: string;
}

/**
 * File with related entities
 */
export interface FileWithLock {
  id: string;
  projectId: string;
  name: string;
  path: string;
  contentHash: string;
  sizeBytes: bigint;
  mimeType: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  hubMessageTs: string | null;
  lock: {
    id: string;
    fileId: string;
    lockedById: string;
    lockedAt: Date;
    expiresAt: Date | null;
    lockReason: string | null;
    lockedBy: {
      id: string;
      slackUserId: string;
      displayName: string;
    };
  } | null;
}

/**
 * File with versions for history display
 */
export interface FileWithVersions {
  id: string;
  projectId: string;
  name: string;
  path: string;
  contentHash: string;
  sizeBytes: bigint;
  mimeType: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  hubMessageTs: string | null;
  versions: Array<{
    id: string;
    fileId: string;
    versionNumber: number;
    contentHash: string;
    sizeBytes: bigint;
    uploadedById: string;
    message: string | null;
    createdAt: Date;
    uploadedBy: {
      id: string;
      displayName: string;
      slackUserId: string;
    };
  }>;
}

/**
 * Lock information with user details
 */
export interface LockInfo {
  id: string;
  fileId: string;
  lockedById: string;
  lockedAt: Date;
  expiresAt: Date | null;
  lockReason: string | null;
  lockedBy: {
    id: string;
    slackUserId: string;
    displayName: string;
    email: string | null;
    avatarUrl: string | null;
  };
}

/**
 * Checkout result containing file and path
 */
export interface CheckoutResult {
  file: FileWithLock;
  filePath: string;
}

/**
 * Checkin result with the new version
 */
export interface CheckinResult {
  file: FileWithLock;
  version: {
    id: string;
    fileId: string;
    versionNumber: number;
    contentHash: string;
    sizeBytes: bigint;
    uploadedById: string;
    message: string | null;
    createdAt: Date;
  };
}

/**
 * Project with file count
 */
export interface ProjectWithFileCount {
  id: string;
  name: string;
  slackTeamId: string;
  hubChannelId: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    files: number;
  };
}

/**
 * Service dependencies interface for dependency injection
 */
export interface ServiceDependencies {
  prisma: PrismaClient;
}
