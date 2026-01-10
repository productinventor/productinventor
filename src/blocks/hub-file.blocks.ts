/**
 * Hub file card block builder
 * Builds the master message displayed in the hub channel for each file
 */

import type { FileWithLock, LockInfo } from '../types';

/**
 * User information for display
 */
export interface HubFileUser {
  id: string;
  slackUserId: string;
  displayName: string;
}

/**
 * Latest version information
 */
export interface LatestVersionInfo {
  versionNumber: number;
  uploadedBy: HubFileUser;
  message: string | null;
  createdAt: Date;
  sizeBytes: bigint;
}

/**
 * Format bytes to human-readable size
 */
function formatFileSize(bytes: bigint | number): string {
  const b = typeof bytes === 'bigint' ? Number(bytes) : bytes;

  if (b < 1024) {
    return `${b} B`;
  } else if (b < 1024 * 1024) {
    return `${(b / 1024).toFixed(1)} KB`;
  } else if (b < 1024 * 1024 * 1024) {
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

/**
 * Format date to relative time string
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  }
}

/**
 * Get file type icon based on MIME type
 */
function getFileTypeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return ':frame_with_picture:';
  if (mimeType.startsWith('video/')) return ':movie_camera:';
  if (mimeType.startsWith('audio/')) return ':musical_note:';
  if (mimeType.includes('pdf')) return ':page_facing_up:';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return ':bar_chart:';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return ':projector:';
  if (mimeType.includes('document') || mimeType.includes('word')) return ':memo:';
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) return ':file_folder:';
  if (mimeType.includes('text/')) return ':page_facing_up:';
  return ':page_facing_up:';
}

/**
 * Build blocks for the hub file card (master message in hub channel)
 */
export function buildHubFileBlocks(
  file: FileWithLock,
  lock: LockInfo | null,
  latestVersion: LatestVersionInfo,
  currentUser: HubFileUser
): object[] {
  const isCheckedOut = lock !== null;
  const isCurrentUserLock = lock?.lockedBy.id === currentUser.id;
  const fileIcon = getFileTypeIcon(file.mimeType);
  const statusEmoji = isCheckedOut ? ':lock:' : ':white_check_mark:';

  const blocks: object[] = [];

  // Header section with file name and status
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${fileIcon} *${file.name}*\n${statusEmoji} ${isCheckedOut ? `Checked out by <@${lock.lockedBy.slackUserId}>` : 'Available'}`,
    },
    accessory: {
      type: 'overflow',
      action_id: 'hub_file_overflow',
      options: [
        {
          text: { type: 'plain_text', text: ':information_source: File Details' },
          value: `details_${file.id}`,
        },
        {
          text: { type: 'plain_text', text: ':link: Copy Link' },
          value: `copy_link_${file.id}`,
        },
        {
          text: { type: 'plain_text', text: ':speech_balloon: Share to Channel' },
          value: `share_${file.id}`,
        },
        ...(isCurrentUserLock ? [{
          text: { type: 'plain_text', text: ':unlock: Release Lock' },
          value: `release_lock_${file.id}`,
        }] : []),
        {
          text: { type: 'plain_text', text: ':wastebasket: Delete File' },
          value: `delete_${file.id}`,
        },
      ],
    },
  });

  // File info context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `:file_folder: \`${file.path}\``,
      },
      {
        type: 'mrkdwn',
        text: `v${latestVersion.versionNumber}`,
      },
      {
        type: 'mrkdwn',
        text: formatFileSize(latestVersion.sizeBytes),
      },
      {
        type: 'mrkdwn',
        text: file.mimeType.split('/')[1]?.toUpperCase() || file.mimeType,
      },
    ],
  });

  // Version message if provided
  if (latestVersion.message) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `> ${latestVersion.message}`,
      },
    });
  }

  // Action buttons based on status
  if (isCheckedOut) {
    if (isCurrentUserLock) {
      // Current user has the lock - show check-in option
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: ':inbox_tray: Check In', emoji: true },
            style: 'primary',
            action_id: 'checkin_file',
            value: file.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: ':clock3: History', emoji: true },
            action_id: 'view_history',
            value: file.id,
          },
        ],
      });
    } else {
      // Another user has the lock
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: ':raised_hand: Request Access', emoji: true },
            action_id: 'request_access',
            value: file.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: ':clock3: History', emoji: true },
            action_id: 'view_history',
            value: file.id,
          },
        ],
      });
    }
  } else {
    // File is available
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':outbox_tray: Download & Check Out', emoji: true },
          style: 'primary',
          action_id: 'checkout_file',
          value: file.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':arrow_down: Download Only', emoji: true },
          action_id: 'download_file',
          value: file.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':clock3: History', emoji: true },
          action_id: 'view_history',
          value: file.id,
        },
      ],
    });
  }

  // Divider
  blocks.push({ type: 'divider' });

  // Last updated context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Last updated by <@${latestVersion.uploadedBy.slackUserId}> ${formatRelativeTime(latestVersion.createdAt)}`,
      },
    ],
  });

  return blocks;
}

/**
 * Build a compact hub file card for list views
 */
export function buildCompactHubFileBlocks(
  file: FileWithLock,
  lock: LockInfo | null
): object[] {
  const isCheckedOut = lock !== null;
  const fileIcon = getFileTypeIcon(file.mimeType);
  const statusEmoji = isCheckedOut ? ':lock:' : ':white_check_mark:';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${statusEmoji} ${fileIcon} *${file.name}* (v${file.currentVersion})\n\`${file.path}\` - ${formatFileSize(file.sizeBytes)}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'View', emoji: true },
        action_id: 'view_file',
        value: file.id,
      },
    },
  ];
}
