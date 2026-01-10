/**
 * Block Kit UI builders for the Slack file checkout system
 *
 * This module exports all block builders for creating Slack Block Kit UIs
 * for various file management views and interactions.
 */

// Hub file card builders
export {
  buildHubFileBlocks,
  buildCompactHubFileBlocks,
  type HubFileUser,
  type LatestVersionInfo,
} from './hub-file.blocks';

// Reference card builders
export {
  buildReferenceBlocks,
  buildReferenceUpdateNotification,
  buildReferenceLockNotification,
  buildReferenceUnlockNotification,
  type SharedVersionInfo,
  type ReferenceState,
} from './reference.blocks';

// File list builders
export {
  buildFileListBlocks,
  buildEmptyProjectBlocks,
  buildFileSearchResultsBlocks,
  type FileListProject,
  type FileListItem,
} from './file-list.blocks';

// Access denied builders
export {
  buildAccessDeniedBlocks,
  buildProjectNotFoundBlocks,
  buildFileNotFoundBlocks,
  buildLockExpiredBlocks,
  buildAlreadyLockedBlocks,
  buildErrorBlocks,
  type AccessDeniedFileInfo,
  type ProjectOwnerInfo,
} from './access-denied.blocks';

// Check-in modal builders
export {
  buildCheckinModal,
  buildReleaseLockModal,
  buildCheckinConfirmationModal,
  buildCheckinErrorModal,
  type CheckinFileInfo,
} from './checkin-modal.blocks';

// Upload modal builders
export {
  buildUploadModal,
  buildUploadSuccessModal,
  buildUploadErrorModal,
  buildDuplicateFileModal,
  buildBulkUploadModal,
  type UploadProjectInfo,
  type DirectoryPaths,
} from './upload-modal.blocks';

// Version history builders
export {
  buildVersionHistoryBlocks,
  buildVersionHistoryModal,
  buildVersionComparisonBlocks,
  buildEmptyHistoryBlocks,
  type VersionHistoryItem,
} from './version-history.blocks';

// Project list builders
export {
  buildProjectListBlocks,
  buildCreateProjectModal,
  buildProjectSettingsModal,
  buildProjectCreatedBlocks,
  buildProjectDeletedBlocks,
  buildNoProjectsBlocks,
  type ProjectListItem,
} from './project-list.blocks';

/**
 * Utility: Format file size to human-readable string
 */
export function formatFileSize(bytes: bigint | number): string {
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
 * Utility: Format date to relative time string
 */
export function formatRelativeTime(date: Date): string {
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
 * Utility: Get file type icon based on MIME type
 */
export function getFileTypeIcon(mimeType: string): string {
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
