/**
 * Reference Service - Reference card management
 *
 * Manages reference cards that appear when files are shared in other channels.
 * Reference cards show the version at share time and update when newer versions exist.
 */

import type { PrismaClient, FileReference } from '@prisma/client';
import type { WebClient } from '@slack/web-api';
import type { FileWithLock } from '../types';
import { FileNotFoundError } from '../utils/errors';

/**
 * ReferenceService manages file reference cards
 */
export class ReferenceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly slack: WebClient
  ) {}

  /**
   * Share a file in a channel by creating a reference card.
   *
   * @param fileId - The file to share
   * @param userId - The user sharing the file
   * @param channelId - The channel to share in
   * @param threadTs - Optional thread timestamp
   * @returns The created reference
   */
  async shareFile(
    fileId: string,
    userId: string,
    channelId: string,
    threadTs?: string
  ): Promise<FileReference> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: { id: true, slackUserId: true, displayName: true },
            },
          },
        },
        project: true,
      },
    });

    if (!file) {
      throw new FileNotFoundError('File not found', fileId);
    }

    // Build reference card blocks
    const blocks = this.buildReferenceBlocks(
      file as FileWithLock & { project: { id: string; name: string; hubChannelId: string } },
      file.currentVersion,
      file.currentVersion
    );

    // Post reference card
    const result = await this.slack.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks,
      text: `Shared file: ${file.name}`,
    });

    // Store reference record
    return this.prisma.fileReference.create({
      data: {
        fileId,
        projectId: file.projectId,
        sharedById: userId,
        sharedVersion: file.currentVersion,
        channelId,
        messageTs: result.ts!,
        threadTs: threadTs || null,
      },
    });
  }

  /**
   * Update all reference cards for a file.
   * Called after a file is checked in with a new version.
   *
   * @param fileId - The file that was updated
   */
  async updateAllReferences(fileId: string): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: {
        lock: {
          include: {
            lockedBy: {
              select: { id: true, slackUserId: true, displayName: true },
            },
          },
        },
        project: true,
      },
    });

    if (!file) {
      return;
    }

    const references = await this.prisma.fileReference.findMany({
      where: { fileId },
    });

    for (const ref of references) {
      try {
        const blocks = this.buildReferenceBlocks(
          file as FileWithLock & { project: { id: string; name: string; hubChannelId: string } },
          ref.sharedVersion,
          file.currentVersion
        );

        await this.slack.chat.update({
          channel: ref.channelId,
          ts: ref.messageTs,
          blocks,
          text: `Shared file: ${file.name}`,
        });
      } catch (error: unknown) {
        // Message may have been deleted - remove reference
        const slackError = error as { data?: { error?: string } };
        if (slackError.data?.error === 'message_not_found') {
          await this.prisma.fileReference.delete({
            where: { id: ref.id },
          });
        }
      }
    }
  }

  /**
   * Get all references for a file.
   *
   * @param fileId - The file ID
   * @returns Array of references
   */
  async getReferencesForFile(fileId: string): Promise<FileReference[]> {
    return this.prisma.fileReference.findMany({
      where: { fileId },
      orderBy: { sharedAt: 'desc' },
    });
  }

  /**
   * Delete a reference card.
   *
   * @param referenceId - The reference ID
   */
  async deleteReference(referenceId: string): Promise<void> {
    const ref = await this.prisma.fileReference.findUnique({
      where: { id: referenceId },
    });

    if (!ref) {
      return;
    }

    // Try to delete the Slack message
    try {
      await this.slack.chat.delete({
        channel: ref.channelId,
        ts: ref.messageTs,
      });
    } catch {
      // Message may already be deleted
    }

    // Delete the reference record
    await this.prisma.fileReference.delete({
      where: { id: referenceId },
    });
  }

  /**
   * Build Block Kit blocks for a reference card.
   */
  private buildReferenceBlocks(
    file: FileWithLock & { project: { id: string; name: string; hubChannelId: string } },
    sharedVersion: number,
    currentVersion: number
  ): unknown[] {
    const hasUpdate = currentVersion > sharedVersion;
    const isLocked = !!file.lock;

    let statusIndicator = '';
    if (hasUpdate) {
      statusIndicator = ' | :warning: Updated';
    } else if (isLocked) {
      statusIndicator = ' | :lock: Locked';
    }

    const blocks: unknown[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📎 *${file.name}*${statusIndicator}`,
        },
      },
    ];

    // Version info
    if (hasUpdate) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Shared: v${sharedVersion}\nCurrent: v${currentVersion} ⚠️ Updated`,
        },
      });
    } else if (isLocked) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Shared: v${sharedVersion}\nCurrently checked out by <@${file.lock!.lockedBy.slackUserId}>`,
        },
      });
    } else {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `v${sharedVersion}`,
          },
        ],
      });
    }

    // Action buttons
    const buttons: unknown[] = [
      {
        type: 'button',
        text: { type: 'plain_text', text: `View in #${file.project.hubChannelId}` },
        url: `slack://channel?team=${file.project.id}&id=${file.project.hubChannelId}`,
        action_id: `ref_view_hub_${file.id}`,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: `Download v${sharedVersion}` },
        action_id: `ref_download_${file.id}_${sharedVersion}`,
      },
    ];

    if (hasUpdate) {
      buttons.push({
        type: 'button',
        text: { type: 'plain_text', text: `Get Latest (v${currentVersion})` },
        style: 'primary',
        action_id: `ref_download_${file.id}_${currentVersion}`,
      });
    }

    blocks.push({
      type: 'actions',
      elements: buttons,
    });

    return blocks;
  }

  /**
   * Clean up orphaned references (where file has been deleted).
   *
   * @returns Number of references cleaned up
   */
  async cleanupOrphanedReferences(): Promise<number> {
    // Find references where file no longer exists
    const orphaned = await this.prisma.fileReference.findMany({
      where: {
        file: null,
      },
    });

    // Delete Slack messages and records
    for (const ref of orphaned) {
      try {
        await this.slack.chat.delete({
          channel: ref.channelId,
          ts: ref.messageTs,
        });
      } catch {
        // Message may already be deleted
      }
    }

    // Delete all orphaned references
    const result = await this.prisma.fileReference.deleteMany({
      where: {
        file: null,
      },
    });

    return result.count;
  }
}
