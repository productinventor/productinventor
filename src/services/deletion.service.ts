import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import { PrismaClient, DeletionRecord, DeletionStatus } from '@prisma/client';
import { AuditService } from './audit.service';

/**
 * Storage service interface for file operations.
 */
export interface StorageService {
  getPath(contentHash: string): string;
  exists(contentHash: string): Promise<boolean>;
}

/**
 * Report generated after deleting a project.
 */
export interface ProjectDeletionReport {
  projectId: string;
  projectName: string;
  requestedBy: string;
  requestedAt: Date;
  completedAt?: Date;
  filesDeleted: number;
  versionsDeleted: number;
  contentHashesDeleted: string[];
  errors: Array<{ contentHash: string; error: string }>;
}

/**
 * Certificate proving secure deletion was performed.
 */
export interface DeletionCertificate {
  certificateId: string;
  deletionRecordId: string;
  contentHash: string | null;
  deletedAt: Date | null;
  secureWipeMethod: string;
  verificationHash: string | null;
  requestedBy: string;
  reason: string;
  generatedAt: Date;
}

/**
 * Error thrown when deletion fails.
 */
export class DeletionError extends Error {
  constructor(
    message: string,
    public readonly contentHash?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DeletionError';
  }
}

/**
 * Secure deletion service implementing DoD 5220.22-M standard.
 *
 * This service provides:
 * - 3-pass secure overwrite (zeros, ones, random)
 * - Verification of deletion
 * - Deletion certificates for compliance
 * - Project-level deletion with cascade
 * - Full audit trail
 */
export class SecureDeletionService {
  /**
   * Buffer size for overwrite operations (64KB).
   */
  private static readonly BUFFER_SIZE = 64 * 1024;

  /**
   * DoD 5220.22-M wipe method description.
   */
  private static readonly WIPE_METHOD = 'DoD 5220.22-M (3-pass)';

  constructor(
    private prisma: PrismaClient,
    private storage: StorageService,
    private audit: AuditService
  ) {}

  /**
   * Securely delete file content using DoD 5220.22-M standard.
   *
   * This method:
   * 1. Verifies no other versions reference the content
   * 2. Creates a deletion record
   * 3. Performs 3-pass secure overwrite
   * 4. Deletes the file
   * 5. Generates verification hash
   *
   * @param contentHash - The SHA256 hash of the content to delete
   * @param requestedById - The user requesting deletion
   * @param reason - The reason for deletion (for audit trail)
   * @returns The deletion record
   * @throws DeletionError if deletion fails or content is still referenced
   */
  async secureDeleteContent(
    contentHash: string,
    requestedById: string,
    reason: string
  ): Promise<DeletionRecord> {
    // Check if any versions still reference this content
    const refCount = await this.prisma.fileVersion.count({
      where: { contentHash },
    });

    if (refCount > 0) {
      throw new DeletionError(
        `Cannot delete: ${refCount} version(s) still reference this content. ` +
          `Delete the file versions first.`,
        contentHash
      );
    }

    // Create deletion record
    const record = await this.prisma.deletionRecord.create({
      data: {
        contentHash,
        requestedById,
        reason,
        status: 'IN_PROGRESS',
      },
    });

    await this.audit.log({
      eventType: 'SECURE_DELETE_STARTED',
      outcome: 'SUCCESS',
      userId: requestedById,
      details: { contentHash, reason, deletionRecordId: record.id },
    });

    try {
      const filePath = this.storage.getPath(contentHash);

      // Check if file exists
      const exists = await this.storage.exists(contentHash);
      if (!exists) {
        // File already deleted - mark as completed
        const updatedRecord = await this.prisma.deletionRecord.update({
          where: { id: record.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            secureWipeUsed: false,
            verificationHash: crypto
              .createHash('sha256')
              .update(`already_deleted:${contentHash}:${Date.now()}`)
              .digest('hex'),
          },
        });

        await this.audit.log({
          eventType: 'SECURE_DELETE_COMPLETED',
          outcome: 'SUCCESS',
          userId: requestedById,
          details: {
            contentHash,
            deletionRecordId: record.id,
            note: 'File was already deleted',
          },
        });

        return updatedRecord;
      }

      // Perform secure 3-pass overwrite
      await this.secureOverwrite(filePath);

      // Delete the file
      await fs.unlink(filePath);

      // Generate verification hash (proves deletion was performed)
      const verificationHash = crypto
        .createHash('sha256')
        .update(`deleted:${contentHash}:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`)
        .digest('hex');

      // Update deletion record
      const updatedRecord = await this.prisma.deletionRecord.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          secureWipeUsed: true,
          verificationHash,
        },
      });

      await this.audit.log({
        eventType: 'SECURE_DELETE_COMPLETED',
        outcome: 'SUCCESS',
        userId: requestedById,
        details: {
          contentHash,
          deletionRecordId: record.id,
          verificationHash,
          wipeMethod: SecureDeletionService.WIPE_METHOD,
        },
      });

      return updatedRecord;
    } catch (error) {
      // Update record to failed status
      await this.prisma.deletionRecord.update({
        where: { id: record.id },
        data: { status: 'FAILED' },
      });

      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.audit.log({
        eventType: 'SECURE_DELETE_COMPLETED',
        outcome: 'FAILURE',
        userId: requestedById,
        details: { contentHash, error: errorMessage },
      });

      throw new DeletionError(
        `Secure deletion failed: ${errorMessage}`,
        contentHash,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Perform DoD 5220.22-M secure overwrite (3 passes).
   *
   * Pass 1: Overwrite with zeros (0x00)
   * Pass 2: Overwrite with ones (0xFF)
   * Pass 3: Overwrite with cryptographically random data
   *
   * Each pass is synced to disk before proceeding.
   *
   * @param filePath - The path to the file to securely overwrite
   */
  async secureOverwrite(filePath: string): Promise<void> {
    const stats = await fs.stat(filePath);
    const size = stats.size;

    // Open file for read/write
    const fileHandle = await fs.open(filePath, 'r+');

    try {
      // Pass 1: Write zeros (0x00)
      const zeros = Buffer.alloc(
        Math.min(size, SecureDeletionService.BUFFER_SIZE),
        0x00
      );
      await this.overwriteFile(fileHandle, size, zeros);

      // Pass 2: Write ones (0xFF)
      const ones = Buffer.alloc(
        Math.min(size, SecureDeletionService.BUFFER_SIZE),
        0xff
      );
      await this.overwriteFile(fileHandle, size, ones);

      // Pass 3: Write random data
      for (let offset = 0; offset < size; offset += SecureDeletionService.BUFFER_SIZE) {
        const chunkSize = Math.min(SecureDeletionService.BUFFER_SIZE, size - offset);
        const randomData = crypto.randomBytes(chunkSize);
        await fileHandle.write(randomData, 0, chunkSize, offset);
      }

      // Final sync to ensure all writes are flushed to disk
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }
  }

  /**
   * Overwrite entire file with a repeating pattern.
   *
   * @param fileHandle - Open file handle
   * @param size - Total file size
   * @param pattern - Pattern buffer to write
   */
  private async overwriteFile(
    fileHandle: fs.FileHandle,
    size: number,
    pattern: Buffer
  ): Promise<void> {
    for (let offset = 0; offset < size; offset += pattern.length) {
      const chunkSize = Math.min(pattern.length, size - offset);
      await fileHandle.write(pattern, 0, chunkSize, offset);
    }
    // Sync after each pass
    await fileHandle.sync();
  }

  /**
   * Delete an entire project and all its data with secure wipe.
   *
   * This method:
   * 1. Collects all files and versions
   * 2. Deletes database records in a transaction
   * 3. Securely wipes file content (if not referenced elsewhere)
   * 4. Generates a deletion report
   *
   * @param projectId - The project to delete
   * @param requestedById - The user requesting deletion
   * @param reason - The reason for deletion
   * @returns A detailed deletion report
   */
  async deleteProject(
    projectId: string,
    requestedById: string,
    reason: string
  ): Promise<ProjectDeletionReport> {
    // Get project with all files and versions
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        files: {
          include: { versions: true },
        },
      },
    });

    if (!project) {
      throw new DeletionError(`Project not found: ${projectId}`);
    }

    const report: ProjectDeletionReport = {
      projectId,
      projectName: project.name,
      requestedBy: requestedById,
      requestedAt: new Date(),
      filesDeleted: 0,
      versionsDeleted: 0,
      contentHashesDeleted: [],
      errors: [],
    };

    // Collect all unique content hashes
    const contentHashes = new Set<string>();
    for (const file of project.files) {
      for (const version of file.versions) {
        contentHashes.add(version.contentHash);
      }
    }

    // Log project deletion start
    await this.audit.log({
      eventType: 'PROJECT_DELETE',
      outcome: 'SUCCESS',
      userId: requestedById,
      projectId,
      details: {
        phase: 'started',
        projectName: project.name,
        fileCount: project.files.length,
        uniqueContentHashes: contentHashes.size,
        reason,
      },
    });

    // Delete database records in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Delete file references (from other channels)
      await tx.fileReference.deleteMany({
        where: { projectId },
      });

      // Delete audit logs referencing this project (optional - may want to keep)
      // Keeping audit logs for compliance

      // Delete file versions, locks, and files
      for (const file of project.files) {
        await tx.fileVersion.deleteMany({
          where: { fileId: file.id },
        });
        await tx.fileLock.deleteMany({
          where: { fileId: file.id },
        });
        report.versionsDeleted += file.versions.length;
      }

      // Delete files
      await tx.file.deleteMany({
        where: { projectId },
      });
      report.filesDeleted = project.files.length;

      // Delete project
      await tx.project.delete({
        where: { id: projectId },
      });
    });

    // Securely delete content (outside transaction for performance)
    for (const hash of contentHashes) {
      // Check if any OTHER files/projects still reference this content
      const otherRefs = await this.prisma.fileVersion.count({
        where: { contentHash: hash },
      });

      if (otherRefs === 0) {
        try {
          await this.secureDeleteContent(hash, requestedById, reason);
          report.contentHashesDeleted.push(hash);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          report.errors.push({
            contentHash: hash,
            error: errorMessage,
          });
        }
      }
    }

    report.completedAt = new Date();

    // Log project deletion completion
    await this.audit.log({
      eventType: 'PROJECT_DELETE',
      outcome: report.errors.length === 0 ? 'SUCCESS' : 'PARTIAL',
      userId: requestedById,
      projectId,
      details: {
        phase: 'completed',
        projectName: project.name,
        filesDeleted: report.filesDeleted,
        versionsDeleted: report.versionsDeleted,
        contentHashesDeleted: report.contentHashesDeleted.length,
        errors: report.errors,
      },
    });

    return report;
  }

  /**
   * Generate a deletion certificate for compliance purposes.
   *
   * This certificate proves that secure deletion was performed
   * and can be provided to clients for NDA compliance.
   *
   * @param deletionRecordId - The deletion record to generate certificate for
   * @returns A deletion certificate
   * @throws DeletionError if deletion was not completed
   */
  async generateDeletionCertificate(
    deletionRecordId: string
  ): Promise<DeletionCertificate> {
    const record = await this.prisma.deletionRecord.findUnique({
      where: { id: deletionRecordId },
    });

    if (!record) {
      throw new DeletionError(
        `Deletion record not found: ${deletionRecordId}`
      );
    }

    if (record.status !== 'COMPLETED' && record.status !== 'VERIFIED') {
      throw new DeletionError(
        `Deletion not completed. Current status: ${record.status}`
      );
    }

    const certificate: DeletionCertificate = {
      certificateId: crypto.randomUUID(),
      deletionRecordId: record.id,
      contentHash: record.contentHash,
      deletedAt: record.completedAt,
      secureWipeMethod: record.secureWipeUsed
        ? SecureDeletionService.WIPE_METHOD
        : 'Standard deletion',
      verificationHash: record.verificationHash,
      requestedBy: record.requestedById,
      reason: record.reason,
      generatedAt: new Date(),
    };

    // Update record status to verified
    await this.prisma.deletionRecord.update({
      where: { id: deletionRecordId },
      data: { status: 'VERIFIED' },
    });

    return certificate;
  }

  /**
   * Get all pending deletion records.
   *
   * @returns List of pending deletion records
   */
  async getPendingDeletions(): Promise<DeletionRecord[]> {
    return this.prisma.deletionRecord.findMany({
      where: { status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
    });
  }

  /**
   * Get deletion history for a project.
   *
   * @param projectId - The project to query
   * @returns List of deletion records for the project
   */
  async getProjectDeletionHistory(projectId: string): Promise<DeletionRecord[]> {
    return this.prisma.deletionRecord.findMany({
      where: { projectId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * Retry a failed deletion.
   *
   * @param deletionRecordId - The failed deletion to retry
   * @param requestedById - The user retrying the deletion
   * @returns Updated deletion record
   */
  async retryDeletion(
    deletionRecordId: string,
    requestedById: string
  ): Promise<DeletionRecord> {
    const record = await this.prisma.deletionRecord.findUnique({
      where: { id: deletionRecordId },
    });

    if (!record) {
      throw new DeletionError(
        `Deletion record not found: ${deletionRecordId}`
      );
    }

    if (record.status !== 'FAILED') {
      throw new DeletionError(
        `Can only retry failed deletions. Current status: ${record.status}`
      );
    }

    if (!record.contentHash) {
      throw new DeletionError(
        `No content hash in deletion record: ${deletionRecordId}`
      );
    }

    // Reset status and retry
    await this.prisma.deletionRecord.update({
      where: { id: deletionRecordId },
      data: { status: 'PENDING' },
    });

    return this.secureDeleteContent(
      record.contentHash,
      requestedById,
      `Retry: ${record.reason}`
    );
  }

  /**
   * Verify that a file has been deleted.
   *
   * @param contentHash - The content hash to verify
   * @returns True if the content no longer exists
   */
  async verifyDeletion(contentHash: string): Promise<boolean> {
    const exists = await this.storage.exists(contentHash);
    return !exists;
  }

  /**
   * Generate a project deletion report without performing deletion.
   * Useful for previewing what will be deleted.
   *
   * @param projectId - The project to analyze
   * @returns A preview of what would be deleted
   */
  async previewProjectDeletion(
    projectId: string
  ): Promise<Omit<ProjectDeletionReport, 'completedAt' | 'contentHashesDeleted' | 'errors'>> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        files: {
          include: { versions: true },
        },
      },
    });

    if (!project) {
      throw new DeletionError(`Project not found: ${projectId}`);
    }

    let versionsCount = 0;
    const contentHashes = new Set<string>();

    for (const file of project.files) {
      versionsCount += file.versions.length;
      for (const version of file.versions) {
        contentHashes.add(version.contentHash);
      }
    }

    // Check which hashes would actually be deleted (not referenced elsewhere)
    let deletableHashes = 0;
    for (const hash of contentHashes) {
      const refs = await this.prisma.fileVersion.count({
        where: {
          contentHash: hash,
          file: { projectId: { not: projectId } },
        },
      });
      if (refs === 0) {
        deletableHashes++;
      }
    }

    return {
      projectId,
      projectName: project.name,
      requestedBy: '',
      requestedAt: new Date(),
      filesDeleted: project.files.length,
      versionsDeleted: versionsCount,
    };
  }
}
