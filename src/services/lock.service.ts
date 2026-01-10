/**
 * Lock Service - Manages file checkout/locking
 *
 * Provides exclusive checkout functionality where only one user
 * can edit a file at a time. Locks automatically expire after 24 hours.
 */

import type { PrismaClient, FileLock } from '@prisma/client';
import type { LockInfo } from '../types';
import { FileLockedError, LockNotFoundError, UnauthorizedError } from '../utils/errors';

/**
 * Default lock expiration time in hours
 */
const DEFAULT_LOCK_EXPIRY_HOURS = 24;

/**
 * LockService handles file locking/checkout operations
 */
export class LockService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Acquire a lock on a file for the specified user.
   * If the file is already locked by another user, throws FileLockedError.
   * If the user already holds the lock, refreshes the expiration time.
   *
   * @param fileId - The ID of the file to lock
   * @param userId - The ID of the user acquiring the lock
   * @param reason - Optional reason for the checkout
   * @returns The created or updated lock
   * @throws FileLockedError if the file is locked by another user
   */
  async acquireLock(
    fileId: string,
    userId: string,
    reason?: string
  ): Promise<FileLock> {
    // Check for existing lock
    const existingLock = await this.prisma.fileLock.findUnique({
      where: { fileId },
      include: {
        lockedBy: {
          select: {
            id: true,
            slackUserId: true,
            displayName: true,
          },
        },
      },
    });

    // If locked by another user, check if expired
    if (existingLock && existingLock.lockedById !== userId) {
      // Check if lock has expired
      if (existingLock.expiresAt && existingLock.expiresAt < new Date()) {
        // Lock expired - delete it and proceed
        await this.prisma.fileLock.delete({
          where: { fileId },
        });
      } else {
        // Lock is still valid - throw error
        throw new FileLockedError(
          `File is currently checked out by ${existingLock.lockedBy.displayName}`,
          existingLock.lockedById,
          existingLock.lockedAt,
          existingLock.expiresAt
        );
      }
    }

    // Calculate expiration time
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + DEFAULT_LOCK_EXPIRY_HOURS);

    // Upsert the lock
    return this.prisma.fileLock.upsert({
      where: { fileId },
      create: {
        fileId,
        lockedById: userId,
        expiresAt,
        lockReason: reason || null,
      },
      update: {
        lockedAt: new Date(),
        expiresAt,
        lockReason: reason || null,
      },
    });
  }

  /**
   * Release a lock on a file.
   * Only the user who holds the lock can release it.
   *
   * @param fileId - The ID of the file to unlock
   * @param userId - The ID of the user releasing the lock
   * @throws LockNotFoundError if no lock exists
   * @throws UnauthorizedError if the user does not own the lock
   */
  async releaseLock(fileId: string, userId: string): Promise<void> {
    const lock = await this.prisma.fileLock.findUnique({
      where: { fileId },
    });

    if (!lock) {
      throw new LockNotFoundError(fileId, 'No lock exists for this file');
    }

    if (lock.lockedById !== userId) {
      throw new UnauthorizedError(
        'You cannot release a lock held by another user'
      );
    }

    await this.prisma.fileLock.delete({
      where: { fileId },
    });
  }

  /**
   * Force release a lock on a file (admin operation).
   * This bypasses the ownership check.
   *
   * @param fileId - The ID of the file to unlock
   * @throws LockNotFoundError if no lock exists
   */
  async forceReleaseLock(fileId: string): Promise<void> {
    const lock = await this.prisma.fileLock.findUnique({
      where: { fileId },
    });

    if (!lock) {
      throw new LockNotFoundError(fileId, 'No lock exists for this file');
    }

    await this.prisma.fileLock.delete({
      where: { fileId },
    });
  }

  /**
   * Check if a file is currently locked.
   * Also considers lock expiration.
   *
   * @param fileId - The ID of the file to check
   * @returns True if the file is locked (and lock hasn't expired)
   */
  async isLocked(fileId: string): Promise<boolean> {
    const lock = await this.prisma.fileLock.findUnique({
      where: { fileId },
    });

    if (!lock) {
      return false;
    }

    // Check if lock has expired
    if (lock.expiresAt && lock.expiresAt < new Date()) {
      // Clean up expired lock
      await this.prisma.fileLock.delete({
        where: { fileId },
      });
      return false;
    }

    return true;
  }

  /**
   * Check if a specific user holds the lock on a file.
   *
   * @param fileId - The ID of the file to check
   * @param userId - The ID of the user to check
   * @returns True if the user holds the lock
   */
  async isLockedByUser(fileId: string, userId: string): Promise<boolean> {
    const lock = await this.prisma.fileLock.findUnique({
      where: { fileId },
    });

    if (!lock) {
      return false;
    }

    // Check if lock has expired
    if (lock.expiresAt && lock.expiresAt < new Date()) {
      // Clean up expired lock
      await this.prisma.fileLock.delete({
        where: { fileId },
      });
      return false;
    }

    return lock.lockedById === userId;
  }

  /**
   * Get detailed lock information for a file.
   * Includes user details for display purposes.
   *
   * @param fileId - The ID of the file
   * @returns Lock info with user details, or null if not locked
   */
  async getLockInfo(fileId: string): Promise<LockInfo | null> {
    const lock = await this.prisma.fileLock.findUnique({
      where: { fileId },
      include: {
        lockedBy: {
          select: {
            id: true,
            slackUserId: true,
            displayName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!lock) {
      return null;
    }

    // Check if lock has expired
    if (lock.expiresAt && lock.expiresAt < new Date()) {
      // Clean up expired lock
      await this.prisma.fileLock.delete({
        where: { fileId },
      });
      return null;
    }

    return lock;
  }

  /**
   * Get all locks held by a specific user.
   *
   * @param userId - The ID of the user
   * @returns Array of locks with file information
   */
  async getLocksByUser(userId: string): Promise<Array<FileLock & { file: { id: string; name: string; path: string } }>> {
    const locks = await this.prisma.fileLock.findMany({
      where: {
        lockedById: userId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        file: {
          select: {
            id: true,
            name: true,
            path: true,
          },
        },
      },
    });

    return locks;
  }

  /**
   * Clean up all expired locks in the system.
   * This can be run as a scheduled job.
   *
   * @returns Number of locks cleaned up
   */
  async cleanupExpiredLocks(): Promise<number> {
    const result = await this.prisma.fileLock.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    return result.count;
  }

  /**
   * Extend the expiration time of an existing lock.
   * Only the lock holder can extend.
   *
   * @param fileId - The ID of the file
   * @param userId - The ID of the user requesting extension
   * @param additionalHours - Number of hours to add to expiration
   * @returns Updated lock
   * @throws LockNotFoundError if no lock exists
   * @throws UnauthorizedError if the user does not own the lock
   */
  async extendLock(
    fileId: string,
    userId: string,
    additionalHours: number = DEFAULT_LOCK_EXPIRY_HOURS
  ): Promise<FileLock> {
    const lock = await this.prisma.fileLock.findUnique({
      where: { fileId },
    });

    if (!lock) {
      throw new LockNotFoundError(fileId, 'No lock exists for this file');
    }

    if (lock.lockedById !== userId) {
      throw new UnauthorizedError(
        'You cannot extend a lock held by another user'
      );
    }

    // Calculate new expiration time from current time
    const newExpiresAt = new Date();
    newExpiresAt.setHours(newExpiresAt.getHours() + additionalHours);

    return this.prisma.fileLock.update({
      where: { fileId },
      data: { expiresAt: newExpiresAt },
    });
  }
}
