/**
 * User Service - Slack user mapping
 *
 * Handles creation and management of internal user records
 * based on Slack user identities. Provides upsert functionality
 * to create or update users from Slack profiles.
 */

import type { PrismaClient, User } from '@prisma/client';
import type { SlackProfile } from '../types';
import { UserNotFoundError } from '../utils/errors';

/**
 * UserService handles Slack user to internal user mapping
 */
export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find or create a user from Slack identity.
   * If the user exists, updates their profile if provided.
   * If the user doesn't exist, creates them.
   *
   * @param slackUserId - The Slack user ID
   * @param slackTeamId - The Slack team/workspace ID
   * @param profile - Optional profile data to update
   * @returns The user record
   */
  async findOrCreateFromSlack(
    slackUserId: string,
    slackTeamId: string,
    profile?: SlackProfile
  ): Promise<User> {
    // Try to find existing user
    const existingUser = await this.prisma.user.findUnique({
      where: { slackUserId },
    });

    if (existingUser) {
      // Update profile if provided
      if (profile && this.hasProfileChanges(existingUser, profile)) {
        return this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            displayName: profile.displayName ?? existingUser.displayName,
            email: profile.email ?? existingUser.email,
            avatarUrl: profile.avatarUrl ?? existingUser.avatarUrl,
          },
        });
      }
      return existingUser;
    }

    // Create new user
    return this.prisma.user.create({
      data: {
        slackUserId,
        slackTeamId,
        displayName: profile?.displayName ?? `User ${slackUserId.slice(-4)}`,
        email: profile?.email ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      },
    });
  }

  /**
   * Find a user by their Slack user ID.
   *
   * @param slackUserId - The Slack user ID
   * @returns The user or null if not found
   */
  async findBySlackId(slackUserId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { slackUserId },
    });
  }

  /**
   * Find a user by their Slack user ID, throwing an error if not found.
   *
   * @param slackUserId - The Slack user ID
   * @returns The user
   * @throws UserNotFoundError if not found
   */
  async findBySlackIdOrThrow(slackUserId: string): Promise<User> {
    const user = await this.findBySlackId(slackUserId);
    if (!user) {
      throw new UserNotFoundError(
        'User not found. Please try again.',
        undefined,
        slackUserId
      );
    }
    return user;
  }

  /**
   * Find a user by their internal ID.
   *
   * @param id - The internal user ID
   * @returns The user or null if not found
   */
  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  /**
   * Find a user by their internal ID, throwing an error if not found.
   *
   * @param id - The internal user ID
   * @returns The user
   * @throws UserNotFoundError if not found
   */
  async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new UserNotFoundError('User not found', id);
    }
    return user;
  }

  /**
   * Update a user's profile.
   *
   * @param userId - The internal user ID
   * @param profile - Profile data to update
   * @returns The updated user
   * @throws UserNotFoundError if user not found
   */
  async updateProfile(userId: string, profile: SlackProfile): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new UserNotFoundError('User not found', userId);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: profile.displayName ?? user.displayName,
        email: profile.email ?? user.email,
        avatarUrl: profile.avatarUrl ?? user.avatarUrl,
      },
    });
  }

  /**
   * Update a user's profile by Slack ID.
   *
   * @param slackUserId - The Slack user ID
   * @param profile - Profile data to update
   * @returns The updated user or null if not found
   */
  async updateProfileBySlackId(
    slackUserId: string,
    profile: SlackProfile
  ): Promise<User | null> {
    const user = await this.findBySlackId(slackUserId);
    if (!user) {
      return null;
    }

    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: profile.displayName ?? user.displayName,
        email: profile.email ?? user.email,
        avatarUrl: profile.avatarUrl ?? user.avatarUrl,
      },
    });
  }

  /**
   * List all users in a Slack team.
   *
   * @param slackTeamId - The Slack team ID
   * @returns Array of users
   */
  async listByTeam(slackTeamId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { slackTeamId },
      orderBy: { displayName: 'asc' },
    });
  }

  /**
   * Get multiple users by their IDs.
   *
   * @param ids - Array of internal user IDs
   * @returns Array of users (in no particular order)
   */
  async findManyByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.prisma.user.findMany({
      where: { id: { in: ids } },
    });
  }

  /**
   * Get multiple users by their Slack IDs.
   *
   * @param slackUserIds - Array of Slack user IDs
   * @returns Array of users (in no particular order)
   */
  async findManyBySlackIds(slackUserIds: string[]): Promise<User[]> {
    if (slackUserIds.length === 0) {
      return [];
    }

    return this.prisma.user.findMany({
      where: { slackUserId: { in: slackUserIds } },
    });
  }

  /**
   * Delete a user by their internal ID.
   * Note: This may fail if the user has related records.
   *
   * @param id - The internal user ID
   * @throws UserNotFoundError if user not found
   */
  async delete(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new UserNotFoundError('User not found', id);
    }

    await this.prisma.user.delete({
      where: { id },
    });
  }

  /**
   * Get user statistics.
   *
   * @param userId - The internal user ID
   * @returns User statistics
   */
  async getStats(userId: string): Promise<{
    filesUploaded: number;
    currentLocks: number;
    referencesShared: number;
    projectsCreated: number;
  }> {
    const [filesUploaded, currentLocks, referencesShared, projectsCreated] =
      await Promise.all([
        this.prisma.fileVersion.count({
          where: { uploadedById: userId },
        }),
        this.prisma.fileLock.count({
          where: { lockedById: userId },
        }),
        this.prisma.fileReference.count({
          where: { sharedById: userId },
        }),
        this.prisma.project.count({
          where: { createdById: userId },
        }),
      ]);

    return {
      filesUploaded,
      currentLocks,
      referencesShared,
      projectsCreated,
    };
  }

  /**
   * Sync a user's profile from Slack.
   * Updates displayName, email, and avatar from Slack profile.
   *
   * @param slackUserId - The Slack user ID
   * @param slackProfile - Raw Slack profile object
   * @returns Updated user or null if not found
   */
  async syncFromSlackProfile(
    slackUserId: string,
    slackProfile: {
      display_name?: string;
      real_name?: string;
      email?: string;
      image_72?: string;
      image_192?: string;
    }
  ): Promise<User | null> {
    const user = await this.findBySlackId(slackUserId);
    if (!user) {
      return null;
    }

    const profile: SlackProfile = {
      displayName: slackProfile.display_name || slackProfile.real_name,
      email: slackProfile.email,
      avatarUrl: slackProfile.image_192 || slackProfile.image_72,
    };

    return this.updateProfile(user.id, profile);
  }

  /**
   * Check if there are any profile changes.
   *
   * @param user - Current user record
   * @param profile - New profile data
   * @returns True if there are changes
   */
  private hasProfileChanges(user: User, profile: SlackProfile): boolean {
    if (profile.displayName && profile.displayName !== user.displayName) {
      return true;
    }
    if (profile.email && profile.email !== user.email) {
      return true;
    }
    if (profile.avatarUrl && profile.avatarUrl !== user.avatarUrl) {
      return true;
    }
    return false;
  }

  /**
   * Ensure a user exists, creating if necessary.
   * Useful for middleware that needs to guarantee user exists.
   *
   * @param slackUserId - The Slack user ID
   * @param slackTeamId - The Slack team ID
   * @returns The user (existing or newly created)
   */
  async ensureExists(slackUserId: string, slackTeamId: string): Promise<User> {
    return this.findOrCreateFromSlack(slackUserId, slackTeamId);
  }

  /**
   * Get a user's display name, with fallback.
   *
   * @param userId - The internal user ID
   * @returns Display name or "Unknown User"
   */
  async getDisplayName(userId: string): Promise<string> {
    const user = await this.findById(userId);
    return user?.displayName ?? 'Unknown User';
  }

  /**
   * Get display names for multiple users as a map.
   *
   * @param userIds - Array of internal user IDs
   * @returns Map of userId to displayName
   */
  async getDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    const users = await this.findManyByIds(userIds);
    const displayNames = new Map<string, string>();

    for (const user of users) {
      displayNames.set(user.id, user.displayName);
    }

    // Fill in missing users with "Unknown User"
    for (const userId of userIds) {
      if (!displayNames.has(userId)) {
        displayNames.set(userId, 'Unknown User');
      }
    }

    return displayNames;
  }
}
