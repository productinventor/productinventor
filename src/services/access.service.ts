/**
 * Access Service - Channel-based access control
 *
 * Handles access control based on Slack channel membership.
 * Users can only access files in projects where they are a member
 * of the project's hub channel.
 */

import type { WebClient } from '@slack/web-api';
import type { Project } from '@prisma/client';
import { AccessDeniedError } from '../utils/errors';

/**
 * Result of a member list fetch, including pagination info
 */
interface MemberListResult {
  members: string[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * AccessService handles channel-based access control
 */
export class AccessService {
  /**
   * Cache for channel membership to reduce Slack API calls
   * Key: `${channelId}:${userId}`
   * Value: { isMember: boolean, cachedAt: number }
   */
  private membershipCache: Map<string, { isMember: boolean; cachedAt: number }>;

  /**
   * Cache duration in milliseconds (5 minutes)
   */
  private readonly cacheDurationMs = 5 * 60 * 1000;

  constructor(private readonly slack: WebClient) {
    this.membershipCache = new Map();
  }

  /**
   * Check if a user can access a project's files.
   * Access is granted if the user is a member of the project's hub channel.
   *
   * @param slackUserId - The Slack user ID
   * @param project - The project to check access for
   * @returns True if the user can access the project
   */
  async canAccessProject(slackUserId: string, project: Project): Promise<boolean> {
    const cacheKey = `${project.hubChannelId}:${slackUserId}`;

    // Check cache first
    const cached = this.membershipCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheDurationMs) {
      return cached.isMember;
    }

    try {
      // Query Slack API for channel membership
      const result = await this.slack.conversations.members({
        channel: project.hubChannelId,
        limit: 1000,
      });

      const isMember = result.members?.includes(slackUserId) ?? false;

      // Cache the result
      this.membershipCache.set(cacheKey, {
        isMember,
        cachedAt: Date.now(),
      });

      return isMember;
    } catch (error: unknown) {
      // Handle specific Slack API errors
      const slackError = error as { data?: { error?: string } };
      if (slackError.data?.error === 'channel_not_found') {
        // Channel doesn't exist or bot isn't in it
        return false;
      }
      if (slackError.data?.error === 'missing_scope') {
        // Bot doesn't have permission to check membership
        console.error('Missing Slack scope for conversations.members');
        return false;
      }

      // For other errors, deny access and don't cache
      console.error('Error checking channel membership:', error);
      return false;
    }
  }

  /**
   * Assert that a user has access to a project.
   * Throws AccessDeniedError if the user doesn't have access.
   *
   * @param slackUserId - The Slack user ID
   * @param project - The project to check access for
   * @throws AccessDeniedError if access is denied
   */
  async assertAccess(slackUserId: string, project: Project): Promise<void> {
    const hasAccess = await this.canAccessProject(slackUserId, project);

    if (!hasAccess) {
      throw new AccessDeniedError(
        `You don't have access to this project. Join #${project.hubChannelId} to access its files.`,
        slackUserId,
        'project',
        project.id
      );
    }
  }

  /**
   * Get all members of a project's hub channel.
   *
   * @param project - The project
   * @returns Array of Slack user IDs
   */
  async getProjectMembers(project: Project): Promise<string[]> {
    const allMembers: string[] = [];
    let cursor: string | undefined;

    try {
      do {
        const result = await this.slack.conversations.members({
          channel: project.hubChannelId,
          limit: 1000,
          cursor,
        });

        if (result.members) {
          allMembers.push(...result.members);
        }

        cursor = result.response_metadata?.next_cursor;
      } while (cursor);

      return allMembers;
    } catch (error: unknown) {
      const slackError = error as { data?: { error?: string } };
      if (slackError.data?.error === 'channel_not_found') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get paginated members of a project's hub channel.
   *
   * @param project - The project
   * @param cursor - Pagination cursor
   * @param limit - Number of members to fetch
   * @returns Member list with pagination info
   */
  async getProjectMembersPaginated(
    project: Project,
    cursor?: string,
    limit: number = 100
  ): Promise<MemberListResult> {
    try {
      const result = await this.slack.conversations.members({
        channel: project.hubChannelId,
        limit,
        cursor,
      });

      return {
        members: result.members ?? [],
        hasMore: !!result.response_metadata?.next_cursor,
        nextCursor: result.response_metadata?.next_cursor,
      };
    } catch (error: unknown) {
      const slackError = error as { data?: { error?: string } };
      if (slackError.data?.error === 'channel_not_found') {
        return { members: [], hasMore: false };
      }
      throw error;
    }
  }

  /**
   * Check if a user is a member of a specific Slack channel.
   *
   * @param slackUserId - The Slack user ID
   * @param channelId - The Slack channel ID
   * @returns True if the user is a member
   */
  async isChannelMember(slackUserId: string, channelId: string): Promise<boolean> {
    const cacheKey = `${channelId}:${slackUserId}`;

    // Check cache first
    const cached = this.membershipCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheDurationMs) {
      return cached.isMember;
    }

    try {
      const result = await this.slack.conversations.members({
        channel: channelId,
        limit: 1000,
      });

      const isMember = result.members?.includes(slackUserId) ?? false;

      // Cache the result
      this.membershipCache.set(cacheKey, {
        isMember,
        cachedAt: Date.now(),
      });

      return isMember;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if sharing a file from one project to a channel is allowed.
   * Sharing is allowed if:
   * 1. The user is a member of both the source project hub and the target channel
   * 2. OR the target channel has overlapping membership with the hub (configurable)
   *
   * @param slackUserId - The Slack user ID attempting to share
   * @param project - The source project
   * @param targetChannelId - The target channel for sharing
   * @returns True if sharing is allowed
   */
  async canShareToChannel(
    slackUserId: string,
    project: Project,
    targetChannelId: string
  ): Promise<boolean> {
    // Check if user has access to the project
    const hasProjectAccess = await this.canAccessProject(slackUserId, project);
    if (!hasProjectAccess) {
      return false;
    }

    // Check if user is a member of the target channel
    const isTargetMember = await this.isChannelMember(slackUserId, targetChannelId);
    if (!isTargetMember) {
      return false;
    }

    return true;
  }

  /**
   * Clear the membership cache for a specific channel.
   * Useful when channel membership changes.
   *
   * @param channelId - The Slack channel ID
   */
  clearCacheForChannel(channelId: string): void {
    for (const key of this.membershipCache.keys()) {
      if (key.startsWith(`${channelId}:`)) {
        this.membershipCache.delete(key);
      }
    }
  }

  /**
   * Clear the entire membership cache.
   */
  clearCache(): void {
    this.membershipCache.clear();
  }

  /**
   * Get channel info from Slack.
   *
   * @param channelId - The Slack channel ID
   * @returns Channel info or null if not found
   */
  async getChannelInfo(channelId: string): Promise<{
    id: string;
    name: string;
    isPrivate: boolean;
    memberCount: number;
  } | null> {
    try {
      const result = await this.slack.conversations.info({
        channel: channelId,
      });

      if (!result.channel) {
        return null;
      }

      return {
        id: result.channel.id!,
        name: result.channel.name ?? 'unknown',
        isPrivate: result.channel.is_private ?? false,
        memberCount: result.channel.num_members ?? 0,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Verify that the bot has access to a channel.
   *
   * @param channelId - The Slack channel ID
   * @returns True if the bot can access the channel
   */
  async botHasChannelAccess(channelId: string): Promise<boolean> {
    try {
      const result = await this.slack.conversations.info({
        channel: channelId,
      });

      return !!result.channel;
    } catch (error: unknown) {
      const slackError = error as { data?: { error?: string } };
      if (
        slackError.data?.error === 'channel_not_found' ||
        slackError.data?.error === 'not_in_channel'
      ) {
        return false;
      }
      throw error;
    }
  }
}
