/**
 * Hub Service - File Hub message management
 *
 * Manages the persistent hub messages for files in project hub channels.
 * Each file has one message in the hub that updates in place as status changes.
 */

import type { PrismaClient } from '@prisma/client';
import type { WebClient } from '@slack/web-api';
import type { FileWithLock } from '../types';

/**
 * HubService manages hub messages for files
 */
export class HubService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly slack: WebClient
  ) {}

  /**
   * Create or update the hub message for a file.
   * Updates the existing message in place or creates a new one.
   *
   * @param file - The file to update the hub message for
   */
  async updateHubMessage(file: FileWithLock): Promise<void> {
    // Get project to find hub channel
    const project = await this.prisma.project.findUnique({
      where: { id: file.projectId },
    });

    if (!project) {
      return;
    }

    // Get latest version info
    const latestVersion = await this.prisma.fileVersion.findFirst({
      where: { fileId: file.id },
      orderBy: { versionNumber: 'desc' },
      include: {
        uploadedBy: {
          select: { slackUserId: true, displayName: true },
        },
      },
    });

    // Build the hub message blocks
    const blocks = this.buildHubFileBlocks(file, latestVersion);

    if (file.hubMessageTs) {
      // Update existing message
      try {
        await this.slack.chat.update({
          channel: project.hubChannelId,
          ts: file.hubMessageTs,
          blocks,
          text: `File: ${file.name}`,
        });
      } catch (error) {
        // Message may have been deleted - create new one
        await this.createHubMessage(file, project.hubChannelId, blocks);
      }
    } else {
      // Create new message
      await this.createHubMessage(file, project.hubChannelId, blocks);
    }
  }

  /**
   * Post an activity message to the hub message thread.
   *
   * @param file - The file
   * @param message - The activity message
   */
  async postActivity(file: FileWithLock, message: string): Promise<void> {
    if (!file.hubMessageTs) {
      return;
    }

    const project = await this.prisma.project.findUnique({
      where: { id: file.projectId },
    });

    if (!project) {
      return;
    }

    await this.slack.chat.postMessage({
      channel: project.hubChannelId,
      thread_ts: file.hubMessageTs,
      text: message,
    });
  }

  /**
   * Create a new hub message for a file.
   */
  private async createHubMessage(
    file: FileWithLock,
    channelId: string,
    blocks: unknown[]
  ): Promise<void> {
    const result = await this.slack.chat.postMessage({
      channel: channelId,
      blocks,
      text: `File: ${file.name}`,
    });

    // Store message reference
    if (result.ts) {
      await this.prisma.file.update({
        where: { id: file.id },
        data: { hubMessageTs: result.ts },
      });
    }
  }

  /**
   * Build Block Kit blocks for a hub file message.
   */
  private buildHubFileBlocks(
    file: FileWithLock,
    latestVersion?: {
      versionNumber: number;
      message: string | null;
      createdAt: Date;
      uploadedBy: { slackUserId: string; displayName: string };
    } | null
  ): unknown[] {
    const statusIcon = file.lock ? '🔒' : '✅';
    const statusText = file.lock
      ? `Checked out by <@${file.lock.lockedBy.slackUserId}>`
      : 'Available';

    const sizeFormatted = this.formatFileSize(Number(file.sizeBytes));
    const lastUpdated = latestVersion
      ? `Last updated by <@${latestVersion.uploadedBy.slackUserId}>`
      : '';
    const versionMessage = latestVersion?.message
      ? `_"${latestVersion.message}"_`
      : '';

    const blocks: unknown[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📁 *${file.name}*\n${file.path}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Version: *v${file.currentVersion}* | Size: ${sizeFormatted} | Type: ${file.mimeType}\nStatus: ${statusIcon} ${statusText}`,
        },
      },
    ];

    if (lastUpdated || versionMessage) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: [lastUpdated, versionMessage].filter(Boolean).join('\n'),
          },
        ],
      });
    }

    // Add action buttons
    if (file.lock) {
      // File is locked - show limited actions
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Request Access' },
            action_id: `file_request_access_${file.id}`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'History' },
            action_id: `file_history_${file.id}`,
          },
        ],
      });
    } else {
      // File is available
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Download & Check Out' },
            style: 'primary',
            action_id: `file_checkout_${file.id}`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Download Only' },
            action_id: `file_download_${file.id}`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'History' },
            action_id: `file_history_${file.id}`,
          },
        ],
      });
    }

    return blocks;
  }

  /**
   * Format file size for display.
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}
