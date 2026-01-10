/**
 * File list view block builder
 * Builds the file browser view from /files command
 */

import type { FileWithLock, LockInfo } from '../types';

/**
 * Project information for file list
 */
export interface FileListProject {
  id: string;
  name: string;
  hubChannelId: string;
  updatedAt: Date;
}

/**
 * File item in the list with lock info
 */
export interface FileListItem {
  id: string;
  name: string;
  path: string;
  currentVersion: number;
  sizeBytes: bigint;
  mimeType: string;
  updatedAt: Date;
  lock: {
    lockedBy: {
      id: string;
      slackUserId: string;
      displayName: string;
    };
    lockedAt: Date;
  } | null;
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
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
 * Build blocks for file browser view
 */
export function buildFileListBlocks(
  project: FileListProject,
  files: FileListItem[],
  currentUserId: string
): object[] {
  const blocks: object[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `:file_cabinet: ${project.name}`,
      emoji: true,
    },
  });

  // File count and last updated
  const lastUpdated = files.length > 0
    ? new Date(Math.max(...files.map(f => f.updatedAt.getTime())))
    : project.updatedAt;

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${files.length} file${files.length === 1 ? '' : 's'} | Last updated ${formatRelativeTime(lastUpdated)}`,
      },
    ],
  });

  // Actions row
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':heavy_plus_sign: Upload File', emoji: true },
        style: 'primary',
        action_id: 'upload_new_file',
        value: project.id,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':arrows_counterclockwise: Refresh', emoji: true },
        action_id: 'refresh_file_list',
        value: project.id,
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // Empty state
  if (files.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':open_file_folder: *No files yet*\n\nUpload your first file to get started!',
      },
    });
    return blocks;
  }

  // Group files by directory
  const filesByDir = new Map<string, FileListItem[]>();
  for (const file of files) {
    const dir = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
    if (!filesByDir.has(dir)) {
      filesByDir.set(dir, []);
    }
    filesByDir.get(dir)!.push(file);
  }

  // Sort directories
  const sortedDirs = Array.from(filesByDir.keys()).sort();

  // Render files grouped by directory
  for (const dir of sortedDirs) {
    const dirFiles = filesByDir.get(dir)!;

    // Directory header (if not root)
    if (dir !== '/' && sortedDirs.length > 1) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `:file_folder: *${dir}*`,
          },
        ],
      });
    }

    // Files in this directory
    for (const file of dirFiles) {
      const isCheckedOut = file.lock !== null;
      const isCurrentUserLock = file.lock?.lockedBy.id === currentUserId;
      const statusIcon = isCheckedOut ? ':lock:' : ':white_check_mark:';
      const fileIcon = getFileTypeIcon(file.mimeType);

      // File info line
      let statusText = '';
      if (isCheckedOut) {
        statusText = isCurrentUserLock
          ? ' _(checked out by you)_'
          : ` _(checked out by <@${file.lock!.lockedBy.slackUserId}>)_`;
      }

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${statusIcon} ${fileIcon} *${file.name}*${statusText}\n\`${file.path}\` | v${file.currentVersion} | ${formatFileSize(file.sizeBytes)}`,
        },
        accessory: {
          type: 'overflow',
          action_id: `file_overflow_${file.id}`,
          options: buildFileOverflowOptions(file, isCheckedOut, isCurrentUserLock),
        },
      });

      // Action buttons for each file
      const actionElements: object[] = [];

      if (isCheckedOut) {
        if (isCurrentUserLock) {
          actionElements.push({
            type: 'button',
            text: { type: 'plain_text', text: ':inbox_tray: Check In', emoji: true },
            style: 'primary',
            action_id: 'checkin_file',
            value: file.id,
          });
        } else {
          actionElements.push({
            type: 'button',
            text: { type: 'plain_text', text: ':raised_hand: Request', emoji: true },
            action_id: 'request_access',
            value: file.id,
          });
        }
        actionElements.push({
          type: 'button',
          text: { type: 'plain_text', text: ':arrow_down: Download', emoji: true },
          action_id: 'download_file',
          value: file.id,
        });
      } else {
        actionElements.push({
          type: 'button',
          text: { type: 'plain_text', text: ':outbox_tray: Check Out', emoji: true },
          style: 'primary',
          action_id: 'checkout_file',
          value: file.id,
        });
        actionElements.push({
          type: 'button',
          text: { type: 'plain_text', text: ':arrow_down: Download', emoji: true },
          action_id: 'download_file',
          value: file.id,
        });
      }

      blocks.push({
        type: 'actions',
        elements: actionElements,
      });
    }
  }

  // Footer with help
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: ':white_check_mark: Available | :lock: Checked out | Use `/files help` for more options',
      },
    ],
  });

  return blocks;
}

/**
 * Build overflow menu options for a file
 */
function buildFileOverflowOptions(
  file: FileListItem,
  isCheckedOut: boolean,
  isCurrentUserLock: boolean
): object[] {
  const options: object[] = [
    {
      text: { type: 'plain_text', text: ':clock3: Version History' },
      value: `history_${file.id}`,
    },
    {
      text: { type: 'plain_text', text: ':information_source: File Details' },
      value: `details_${file.id}`,
    },
    {
      text: { type: 'plain_text', text: ':speech_balloon: Share to Channel' },
      value: `share_${file.id}`,
    },
  ];

  if (isCurrentUserLock) {
    options.push({
      text: { type: 'plain_text', text: ':unlock: Release Lock' },
      value: `release_lock_${file.id}`,
    });
  }

  options.push({
    text: { type: 'plain_text', text: ':wastebasket: Delete File' },
    value: `delete_${file.id}`,
  });

  return options;
}

/**
 * Build empty project state blocks
 */
export function buildEmptyProjectBlocks(project: FileListProject): object[] {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `:file_cabinet: ${project.name}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':open_file_folder: *No files yet*\n\nThis project hub is empty. Upload your first file to get started!',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':heavy_plus_sign: Upload File', emoji: true },
          style: 'primary',
          action_id: 'upload_new_file',
          value: project.id,
        },
      ],
    },
  ];
}

/**
 * Build file search results blocks
 */
export function buildFileSearchResultsBlocks(
  query: string,
  files: FileListItem[],
  currentUserId: string
): object[] {
  const blocks: object[] = [];

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `:mag: *Search results for "${query}"*\n${files.length} file${files.length === 1 ? '' : 's'} found`,
    },
  });

  blocks.push({ type: 'divider' });

  if (files.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'No files match your search. Try a different query.',
      },
    });
    return blocks;
  }

  for (const file of files) {
    const isCheckedOut = file.lock !== null;
    const statusIcon = isCheckedOut ? ':lock:' : ':white_check_mark:';
    const fileIcon = getFileTypeIcon(file.mimeType);

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${statusIcon} ${fileIcon} *${file.name}*\n\`${file.path}\` | v${file.currentVersion} | ${formatFileSize(file.sizeBytes)}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'View', emoji: true },
        action_id: 'view_file',
        value: file.id,
      },
    });
  }

  return blocks;
}
