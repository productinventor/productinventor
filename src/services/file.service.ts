/**
 * File Service - Core file operations for checkout/checkin system
 *
 * Handles file checkout, checkin, version management, and file queries.
 * Integrates with LockService, StorageService, HubService, and ReferenceService.
 */

import type { PrismaClient, File, FileVersion } from '@prisma/client';
import type { FileWithLock, FileWithVersions, CheckoutResult, CheckinResult } from '../types';
import {
  FileNotFoundError,
  UnauthorizedError,
  VersionNotFoundError,
} from '../utils/errors';
import type { LockService } from './lock.service';
import type { StorageService } from './storage.service';
import type { HubService } from './hub.service';
import type { ReferenceService } from './reference.service';

/**
 * FileService handles all file operations including checkout/checkin
 */
export class FileService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storageService: StorageService,
    private readonly lockService: LockService,
    private readonly hubService: HubService,
    private readonly referenceService: ReferenceService
  ) {}

  /**
   * Check out a file for editing.
   * Acquires a lock and returns the file with its storage path.
   *
   * @param fileId - The ID of the file to check out
   * @param userId - The ID of the user checking out the file
   * @returns The file details and path to the file content
   * @throws FileNotFoundError if the file doesn't exist
   * @throws FileLockedError if locked by another user
   */
  async checkoutFile(fileId: string, userId: string): Promise<CheckoutResult> {
    // Get the file with lock info
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: {
                id: true,
                slackUserId: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!file) {
      throw new FileNotFoundError('File not found', fileId);
    }

    // Acquire the lock (throws FileLockedError if locked by another user)
    await this.lockService.acquireLock(fileId, userId);

    // Fetch updated file with lock info
    const updatedFile = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: {
                id: true,
                slackUserId: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    // Get the path to the file content
    const filePath = this.storageService.getPath(file.contentHash);

    // Update hub message to show locked status
    await this.hubService.updateHubMessage(updatedFile!);

    // Update all reference cards to show locked status
    await this.referenceService.updateAllReferences(fileId);

    return {
      file: updatedFile as FileWithLock,
      filePath,
    };
  }

  /**
   * Check in a file with a new version.
   * Verifies lock ownership, stores the file, creates version record,
   * and releases the lock.
   *
   * @param fileId - The ID of the file to check in
   * @param userId - The ID of the user checking in
   * @param uploadedFilePath - Path to the uploaded file on disk
   * @param message - Optional version message/description
   * @returns The updated file and new version
   * @throws FileNotFoundError if the file doesn't exist
   * @throws UnauthorizedError if the user doesn't hold the lock
   */
  async checkinFile(
    fileId: string,
    userId: string,
    uploadedFilePath: string,
    message?: string
  ): Promise<CheckinResult> {
    // Get the file with lock info
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        lock: true,
      },
    });

    if (!file) {
      throw new FileNotFoundError('File not found', fileId);
    }

    // Verify the user holds the lock
    if (!file.lock || file.lock.lockedById !== userId) {
      throw new UnauthorizedError(
        'You must have the file checked out to check it in'
      );
    }

    // Store the file in content-addressed storage
    const { hash, size } = await this.storageService.store(uploadedFilePath);

    // Use a transaction to create version, update file, and release lock
    const result = await this.prisma.$transaction(async (tx) => {
      // Create new version
      const version = await tx.fileVersion.create({
        data: {
          fileId,
          versionNumber: file.currentVersion + 1,
          contentHash: hash,
          sizeBytes: size,
          uploadedById: userId,
          message: message || null,
        },
      });

      // Update file with new version info
      await tx.file.update({
        where: { id: fileId },
        data: {
          contentHash: hash,
          sizeBytes: size,
          currentVersion: file.currentVersion + 1,
        },
      });

      // Release the lock
      await tx.fileLock.delete({
        where: { fileId },
      });

      return version;
    });

    // Fetch updated file
    const updatedFile = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: {
                id: true,
                slackUserId: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    // Update hub message to show new version and unlocked status
    await this.hubService.updateHubMessage(updatedFile!);

    // Update all reference cards to show new version available
    await this.referenceService.updateAllReferences(fileId);

    return {
      file: updatedFile as FileWithLock,
      version: result,
    };
  }

  /**
   * Get the storage path for a specific file version.
   *
   * @param fileId - The ID of the file
   * @param versionNumber - Optional version number (defaults to current)
   * @returns Path to the file content
   * @throws FileNotFoundError if the file doesn't exist
   * @throws VersionNotFoundError if the version doesn't exist
   */
  async getVersionPath(fileId: string, versionNumber?: number): Promise<string> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
        },
      },
    });

    if (!file) {
      throw new FileNotFoundError('File not found', fileId);
    }

    // Find the requested version or use current
    const targetVersion = versionNumber ?? file.currentVersion;
    const version = file.versions.find((v) => v.versionNumber === targetVersion);

    if (!version) {
      throw new VersionNotFoundError(fileId, targetVersion);
    }

    return this.storageService.getPath(version.contentHash);
  }

  /**
   * List all files in a project.
   *
   * @param projectId - The ID of the project
   * @returns Array of files with lock information
   */
  async listByProject(projectId: string): Promise<FileWithLock[]> {
    const files = await this.prisma.file.findMany({
      where: { projectId },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: {
                id: true,
                slackUserId: true,
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return files as FileWithLock[];
  }

  /**
   * Find a file by name within a project.
   *
   * @param name - The file name to search for
   * @param projectId - The ID of the project
   * @returns The file or null if not found
   */
  async findByNameInProject(
    name: string,
    projectId: string
  ): Promise<FileWithLock | null> {
    const file = await this.prisma.file.findFirst({
      where: {
        projectId,
        name: { equals: name, mode: 'insensitive' },
      },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: {
                id: true,
                slackUserId: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    return file as FileWithLock | null;
  }

  /**
   * Find a file by name across all projects the user can access.
   * Returns the first match found.
   *
   * @param name - The file name to search for
   * @param userId - The internal user ID for access filtering
   * @param accessibleProjectIds - Array of project IDs the user can access
   * @returns The file or null if not found
   */
  async findByNameWithAccess(
    name: string,
    accessibleProjectIds: string[]
  ): Promise<FileWithLock | null> {
    if (accessibleProjectIds.length === 0) {
      return null;
    }

    const file = await this.prisma.file.findFirst({
      where: {
        projectId: { in: accessibleProjectIds },
        name: { equals: name, mode: 'insensitive' },
      },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: {
                id: true,
                slackUserId: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    return file as FileWithLock | null;
  }

  /**
   * Get a file by ID with lock information.
   *
   * @param fileId - The ID of the file
   * @returns The file or null if not found
   */
  async findById(fileId: string): Promise<FileWithLock | null> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: {
                id: true,
                slackUserId: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    return file as FileWithLock | null;
  }

  /**
   * Get a file with full version history.
   *
   * @param fileId - The ID of the file
   * @returns The file with versions or null
   */
  async findWithVersions(fileId: string): Promise<FileWithVersions | null> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        versions: {
          include: {
            uploadedBy: {
              select: {
                id: true,
                displayName: true,
                slackUserId: true,
              },
            },
          },
          orderBy: { versionNumber: 'desc' },
        },
      },
    });

    return file as FileWithVersions | null;
  }

  /**
   * Create a new file in a project.
   *
   * @param data - File creation data
   * @returns The created file
   */
  async create(data: {
    projectId: string;
    name: string;
    path: string;
    mimeType: string;
    uploadedFilePath: string;
    uploadedById: string;
    message?: string;
  }): Promise<FileWithLock> {
    // Store the file
    const { hash, size } = await this.storageService.store(data.uploadedFilePath);

    // Create file and initial version in transaction
    const file = await this.prisma.$transaction(async (tx) => {
      // Create the file record
      const newFile = await tx.file.create({
        data: {
          projectId: data.projectId,
          name: data.name,
          path: data.path,
          contentHash: hash,
          sizeBytes: size,
          mimeType: data.mimeType,
          currentVersion: 1,
        },
      });

      // Create the initial version
      await tx.fileVersion.create({
        data: {
          fileId: newFile.id,
          versionNumber: 1,
          contentHash: hash,
          sizeBytes: size,
          uploadedById: data.uploadedById,
          message: data.message || 'Initial version',
        },
      });

      return newFile;
    });

    // Fetch with lock info
    const fileWithLock = await this.prisma.file.findUnique({
      where: { id: file.id },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: {
                id: true,
                slackUserId: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    return fileWithLock as FileWithLock;
  }

  /**
   * Delete a file and all its versions.
   * Can only be done if the file is not locked.
   *
   * @param fileId - The ID of the file to delete
   * @throws FileNotFoundError if the file doesn't exist
   * @throws UnauthorizedError if the file is locked
   */
  async delete(fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: { lock: true },
    });

    if (!file) {
      throw new FileNotFoundError('File not found', fileId);
    }

    if (file.lock) {
      throw new UnauthorizedError(
        'Cannot delete a file that is currently checked out'
      );
    }

    // Delete in transaction
    await this.prisma.$transaction(async (tx) => {
      // Delete references first
      await tx.fileReference.deleteMany({ where: { fileId } });
      // Delete versions
      await tx.fileVersion.deleteMany({ where: { fileId } });
      // Delete file
      await tx.file.delete({ where: { id: fileId } });
    });

    // Note: Storage cleanup of orphaned content hashes
    // should be done by a separate garbage collection process
  }

  /**
   * Search for files by name pattern across accessible projects.
   *
   * @param pattern - Search pattern (case-insensitive contains)
   * @param accessibleProjectIds - Projects the user can access
   * @param limit - Maximum results to return
   * @returns Array of matching files
   */
  async searchByName(
    pattern: string,
    accessibleProjectIds: string[],
    limit: number = 20
  ): Promise<FileWithLock[]> {
    if (accessibleProjectIds.length === 0) {
      return [];
    }

    const files = await this.prisma.file.findMany({
      where: {
        projectId: { in: accessibleProjectIds },
        name: { contains: pattern, mode: 'insensitive' },
      },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: {
                id: true,
                slackUserId: true,
                displayName: true,
              },
            },
          },
        },
      },
      take: limit,
      orderBy: { name: 'asc' },
    });

    return files as FileWithLock[];
  }
}
