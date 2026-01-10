/**
 * Reference card block builder
 * Builds reference cards shared in other channels that link back to hub files
 */

import type { FileWithLock, LockInfo } from '../types';

/**
 * Shared version information
 */
export interface SharedVersionInfo {
  versionNumber: number;
  sharedAt: Date;
  sharedBy: {
    id: string;
    slackUserId: string;
    displayName: string;
  };
}

/**
 * Reference card state
 */
export type ReferenceState = 'up_to_date' | 'newer_available' | 'locked';

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
 * Determine the reference card state
 */
function getReferenceState(
  sharedVersion: number,
  currentVersion: number,
  lock: LockInfo | null
): ReferenceState {
  if (lock !== null) {
    return 'locked';
  }
  if (currentVersion > sharedVersion) {
    return 'newer_available';
  }
  return 'up_to_date';
}

/**
 * Build blocks for reference card shared in other channels
 */
export function buildReferenceBlocks(
  file: FileWithLock,
  sharedVersion: SharedVersionInfo,
  currentVersion: number,
  lock: LockInfo | null,
  hubChannelId: string
): object[] {
  const state = getReferenceState(sharedVersion.versionNumber, currentVersion, lock);
  const fileIcon = getFileTypeIcon(file.mimeType);

  const blocks: object[] = [];

  // Status badge based on state
  let statusBadge: string;
  let statusColor: string;

  switch (state) {
    case 'up_to_date':
      statusBadge = ':white_check_mark: Up to date';
      statusColor = 'good';
      break;
    case 'newer_available':
      statusBadge = `:warning: Updated - v${currentVersion} available`;
      statusColor = 'warning';
      break;
    case 'locked':
      statusBadge = `:lock: Locked by <@${lock!.lockedBy.slackUserId}>`;
      statusColor = 'danger';
      break;
  }

  // Header with file info and status
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${fileIcon} *${file.name}*\n${statusBadge}`,
    },
  });

  // File details context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `:file_folder: \`${file.path}\``,
      },
      {
        type: 'mrkdwn',
        text: `v${sharedVersion.versionNumber}${state === 'newer_available' ? ` (latest: v${currentVersion})` : ''}`,
      },
      {
        type: 'mrkdwn',
        text: formatFileSize(file.sizeBytes),
      },
    ],
  });

  // Action buttons based on state
  const actionElements: object[] = [];

  // Always show "View in #files" button
  actionElements.push({
    type: 'button',
    text: { type: 'plain_text', text: ':mag: View in Hub', emoji: true },
    action_id: 'view_in_hub',
    value: JSON.stringify({ fileId: file.id, hubChannelId }),
  });

  switch (state) {
    case 'up_to_date':
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: ':arrow_down: Download', emoji: true },
        action_id: 'download_shared_version',
        value: JSON.stringify({ fileId: file.id, version: sharedVersion.versionNumber }),
      });
      break;

    case 'newer_available':
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: `:arrow_down: Download v${sharedVersion.versionNumber}`, emoji: true },
        action_id: 'download_shared_version',
        value: JSON.stringify({ fileId: file.id, version: sharedVersion.versionNumber }),
      });
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: `:sparkles: Get Latest (v${currentVersion})`, emoji: true },
        style: 'primary',
        action_id: 'download_latest_version',
        value: JSON.stringify({ fileId: file.id, version: currentVersion }),
      });
      break;

    case 'locked':
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: `:arrow_down: Download v${sharedVersion.versionNumber}`, emoji: true },
        action_id: 'download_shared_version',
        value: JSON.stringify({ fileId: file.id, version: sharedVersion.versionNumber }),
      });
      break;
  }

  blocks.push({
    type: 'actions',
    elements: actionElements,
  });

  // Shared by context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Shared by <@${sharedVersion.sharedBy.slackUserId}> - v${sharedVersion.versionNumber}`,
      },
    ],
  });

  return blocks;
}

/**
 * Build an updated reference card notification when file is updated
 */
export function buildReferenceUpdateNotification(
  file: FileWithLock,
  previousVersion: number,
  newVersion: number,
  updatedBy: { slackUserId: string; displayName: string },
  hubChannelId: string
): object[] {
  const fileIcon = getFileTypeIcon(file.mimeType);

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:bell: *File Updated*\n${fileIcon} *${file.name}* has been updated from v${previousVersion} to v${newVersion} by <@${updatedBy.slackUserId}>`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':mag: View in Hub', emoji: true },
          action_id: 'view_in_hub',
          value: JSON.stringify({ fileId: file.id, hubChannelId }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: `:sparkles: Get v${newVersion}`, emoji: true },
          style: 'primary',
          action_id: 'download_latest_version',
          value: JSON.stringify({ fileId: file.id, version: newVersion }),
        },
      ],
    },
  ];
}

/**
 * Build a lock notification for reference card channels
 */
export function buildReferenceLockNotification(
  file: FileWithLock,
  lockedBy: { slackUserId: string; displayName: string },
  hubChannelId: string
): object[] {
  const fileIcon = getFileTypeIcon(file.mimeType);

  return [
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `:lock: ${fileIcon} *${file.name}* is now checked out by <@${lockedBy.slackUserId}>`,
        },
      ],
    },
  ];
}

/**
 * Build an unlock notification for reference card channels
 */
export function buildReferenceUnlockNotification(
  file: FileWithLock,
  unlockedBy: { slackUserId: string; displayName: string },
  newVersion: number | null
): object[] {
  const fileIcon = getFileTypeIcon(file.mimeType);

  const message = newVersion
    ? `:unlock: ${fileIcon} *${file.name}* has been checked in (now v${newVersion}) by <@${unlockedBy.slackUserId}>`
    : `:unlock: ${fileIcon} *${file.name}* lock released by <@${unlockedBy.slackUserId}>`;

  return [
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: message,
        },
      ],
    },
  ];
}
