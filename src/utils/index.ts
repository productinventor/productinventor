/**
 * Utilities Index - Export all utility functions
 *
 * Provides formatting, Slack helpers, and error classes for the
 * Slack file checkout system.
 */

// Formatting utilities
export {
  formatFileSize,
  formatDate,
  formatRelativeTime,
  truncatePath,
  formatDuration,
  formatNumber,
  formatVersion,
} from './format.js';

// Slack helper utilities
export {
  buildDeepLink,
  buildDeepLinkWithTeam,
  buildWebLink,
  extractFileId,
  extractFileIdAndVersion,
  parseCommand,
  formatUserMention,
  formatChannelMention,
  formatLink,
  escapeMarkdown,
  extractUserIdFromMention,
  extractChannelIdFromMention,
  buildActionId,
} from './slack.js';
export type { ParsedCommand } from './slack.js';

// Error classes
export {
  AppError,
  FileLockedError,
  FileNotFoundError,
  AccessDeniedError,
  UnauthorizedError,
  ProjectNotFoundError,
  UserNotFoundError,
  LockNotFoundError,
  VersionNotFoundError,
  ProjectAlreadyExistsError,
  StorageError,
} from './errors.js';
