/**
 * Version history view block builder
 * Builds the version history view for a file
 */

import type { FileWithVersions } from '../types';

/**
 * Version item for history display
 */
export interface VersionHistoryItem {
  id: string;
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
 * Format date for history display
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } else if (diffDays === 1) {
    return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      hour: 'numeric',
      minute: '2-digit',
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
 * Build version history view blocks
 */
export function buildVersionHistoryBlocks(
  file: FileWithVersions,
  hubChannelId?: string
): object[] {
  const blocks: object[] = [];
  const fileIcon = getFileTypeIcon(file.mimeType);

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: ':clock3: Version History',
      emoji: true,
    },
  });

  // File info
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${fileIcon} *${file.name}*\n\`${file.path}\``,
    },
  });

  // Current version info
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Current: v${file.currentVersion} | ${file.versions.length} version${file.versions.length === 1 ? '' : 's'} total`,
      },
    ],
  });

  // Back button
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':arrow_left: Back to Files', emoji: true },
        action_id: 'back_to_files',
        value: hubChannelId || '',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':arrows_counterclockwise: Refresh', emoji: true },
        action_id: 'refresh_history',
        value: file.id,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // Sort versions by version number descending (newest first)
  const sortedVersions = [...file.versions].sort((a, b) => b.versionNumber - a.versionNumber);

  // Version list
  for (let i = 0; i < sortedVersions.length; i++) {
    const version = sortedVersions[i];
    const isLatest = version.versionNumber === file.currentVersion;
    const isFirst = version.versionNumber === 1;

    // Version header with badge
    let versionLabel = `*v${version.versionNumber}*`;
    if (isLatest) {
      versionLabel += ' :star: _Latest_';
    } else if (isFirst) {
      versionLabel += ' :seedling: _Initial_';
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${versionLabel}\n<@${version.uploadedBy.slackUserId}> - ${formatDate(version.createdAt)}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: ':arrow_down: Download', emoji: true },
        action_id: 'download_version',
        value: JSON.stringify({ fileId: file.id, version: version.versionNumber }),
      },
    });

    // Version details context
    const contextElements: object[] = [
      {
        type: 'mrkdwn',
        text: formatFileSize(version.sizeBytes),
      },
    ];

    // Add message if present
    if (version.message) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `> ${version.message}`,
        },
      });
    }

    blocks.push({
      type: 'context',
      elements: contextElements,
    });

    // Add divider between versions (but not after the last one)
    if (i < sortedVersions.length - 1) {
      blocks.push({ type: 'divider' });
    }
  }

  // Footer
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: ':information_source: All versions are permanently stored and can be downloaded at any time.',
      },
    ],
  });

  return blocks;
}

/**
 * Build compact version history for modal view
 */
export function buildVersionHistoryModal(file: FileWithVersions): object {
  const fileIcon = getFileTypeIcon(file.mimeType);
  const sortedVersions = [...file.versions].sort((a, b) => b.versionNumber - a.versionNumber);

  const versionBlocks: object[] = [];

  for (const version of sortedVersions) {
    const isLatest = version.versionNumber === file.currentVersion;

    versionBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*v${version.versionNumber}*${isLatest ? ' :star:' : ''} - ${formatFileSize(version.sizeBytes)}\n<@${version.uploadedBy.slackUserId}> | ${formatDate(version.createdAt)}${version.message ? `\n> ${version.message}` : ''}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Download', emoji: true },
        action_id: 'download_version',
        value: JSON.stringify({ fileId: file.id, version: version.versionNumber }),
      },
    });
  }

  return {
    type: 'modal',
    callback_id: 'version_history_modal',
    title: {
      type: 'plain_text',
      text: 'Version History',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Close',
      emoji: true,
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${fileIcon} *${file.name}*\n\`${file.path}\``,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${file.versions.length} version${file.versions.length === 1 ? '' : 's'}`,
          },
        ],
      },
      { type: 'divider' },
      ...versionBlocks,
    ],
  };
}

/**
 * Build version comparison view (for showing changes between versions)
 */
export function buildVersionComparisonBlocks(
  file: FileWithVersions,
  fromVersion: VersionHistoryItem,
  toVersion: VersionHistoryItem
): object[] {
  const fileIcon = getFileTypeIcon(file.mimeType);
  const sizeDiff = Number(toVersion.sizeBytes) - Number(fromVersion.sizeBytes);
  const sizeDiffText = sizeDiff > 0
    ? `+${formatFileSize(sizeDiff)}`
    : sizeDiff < 0
      ? `-${formatFileSize(Math.abs(sizeDiff))}`
      : 'No change';

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':mag: Version Comparison',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${fileIcon} *${file.name}*`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*From: v${fromVersion.versionNumber}*\n${formatFileSize(fromVersion.sizeBytes)}\n<@${fromVersion.uploadedBy.slackUserId}>\n${formatDate(fromVersion.createdAt)}`,
        },
        {
          type: 'mrkdwn',
          text: `*To: v${toVersion.versionNumber}*\n${formatFileSize(toVersion.sizeBytes)}\n<@${toVersion.uploadedBy.slackUserId}>\n${formatDate(toVersion.createdAt)}`,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Size change: ${sizeDiffText}`,
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: `:arrow_down: Download v${fromVersion.versionNumber}`, emoji: true },
          action_id: 'download_version',
          value: JSON.stringify({ fileId: file.id, version: fromVersion.versionNumber }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: `:arrow_down: Download v${toVersion.versionNumber}`, emoji: true },
          style: 'primary',
          action_id: 'download_version',
          value: JSON.stringify({ fileId: file.id, version: toVersion.versionNumber }),
        },
      ],
    },
  ];
}

/**
 * Build empty history state
 */
export function buildEmptyHistoryBlocks(fileName: string): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:clock3: *Version History*\n\n*${fileName}*\n\nNo version history available for this file.`,
      },
    },
  ];
}
