/**
 * Formatting utilities for the Slack file checkout system.
 *
 * Provides functions for formatting file sizes, dates, relative times,
 * and path truncation for display in Slack messages.
 */

/**
 * File size units in ascending order.
 */
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Format a file size in bytes to a human-readable string.
 *
 * @param bytes - The file size in bytes
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string like "1.5 MB" or "256 KB"
 *
 * @example
 * formatFileSize(1024) // "1.0 KB"
 * formatFileSize(1536) // "1.5 KB"
 * formatFileSize(1048576) // "1.0 MB"
 * formatFileSize(1073741824) // "1.0 GB"
 */
export function formatFileSize(bytes: number | bigint, decimals: number = 1): string {
  const numBytes = typeof bytes === 'bigint' ? Number(bytes) : bytes;

  if (numBytes === 0) {
    return '0 B';
  }

  if (numBytes < 0) {
    return `-${formatFileSize(-numBytes, decimals)}`;
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;

  let unitIndex = 0;
  let size = numBytes;

  while (size >= k && unitIndex < SIZE_UNITS.length - 1) {
    size /= k;
    unitIndex++;
  }

  return `${size.toFixed(dm)} ${SIZE_UNITS[unitIndex]}`;
}

/**
 * Format a date for display.
 * Uses a consistent format: "Jan 15, 2024 at 2:30 PM"
 *
 * @param date - The date to format
 * @param includeTime - Whether to include the time (default: true)
 * @returns Formatted date string
 *
 * @example
 * formatDate(new Date('2024-01-15T14:30:00')) // "Jan 15, 2024 at 2:30 PM"
 * formatDate(new Date('2024-01-15'), false) // "Jan 15, 2024"
 */
export function formatDate(date: Date | string | number, includeTime: boolean = true): string {
  const d = new Date(date);

  if (isNaN(d.getTime())) {
    return 'Invalid date';
  }

  const dateOptions: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };

  const dateStr = d.toLocaleDateString('en-US', dateOptions);

  if (!includeTime) {
    return dateStr;
  }

  const timeStr = d.toLocaleTimeString('en-US', timeOptions);
  return `${dateStr} at ${timeStr}`;
}

/**
 * Time intervals for relative time formatting (in seconds).
 */
const TIME_INTERVALS = [
  { seconds: 31536000, label: 'year' },
  { seconds: 2592000, label: 'month' },
  { seconds: 604800, label: 'week' },
  { seconds: 86400, label: 'day' },
  { seconds: 3600, label: 'hour' },
  { seconds: 60, label: 'minute' },
  { seconds: 1, label: 'second' },
] as const;

/**
 * Format a date as a relative time string.
 * Returns strings like "2 hours ago", "3 days ago", "just now", etc.
 *
 * @param date - The date to format
 * @returns Relative time string
 *
 * @example
 * formatRelativeTime(new Date(Date.now() - 3600000)) // "1 hour ago"
 * formatRelativeTime(new Date(Date.now() - 7200000)) // "2 hours ago"
 * formatRelativeTime(new Date(Date.now() - 86400000)) // "1 day ago"
 */
export function formatRelativeTime(date: Date | string | number): string {
  const d = new Date(date);

  if (isNaN(d.getTime())) {
    return 'Invalid date';
  }

  const now = Date.now();
  const timestamp = d.getTime();
  const diffSeconds = Math.floor((now - timestamp) / 1000);

  // Future dates
  if (diffSeconds < 0) {
    return formatFutureRelativeTime(Math.abs(diffSeconds));
  }

  // Just now (within 10 seconds)
  if (diffSeconds < 10) {
    return 'just now';
  }

  // Find the appropriate interval
  for (const interval of TIME_INTERVALS) {
    const count = Math.floor(diffSeconds / interval.seconds);
    if (count >= 1) {
      const label = count === 1 ? interval.label : `${interval.label}s`;
      return `${count} ${label} ago`;
    }
  }

  return 'just now';
}

/**
 * Format a future relative time.
 *
 * @param diffSeconds - Seconds until the time
 * @returns Relative time string for future dates
 */
function formatFutureRelativeTime(diffSeconds: number): string {
  for (const interval of TIME_INTERVALS) {
    const count = Math.floor(diffSeconds / interval.seconds);
    if (count >= 1) {
      const label = count === 1 ? interval.label : `${interval.label}s`;
      return `in ${count} ${label}`;
    }
  }

  return 'in a moment';
}

/**
 * Truncate a file path to a maximum length.
 * Preserves the beginning and end of the path, replacing the middle with "...".
 *
 * @param path - The file path to truncate
 * @param maxLength - Maximum length (default: 50)
 * @returns Truncated path string
 *
 * @example
 * truncatePath('/very/long/path/to/some/file.txt', 30)
 * // "/very/long/.../some/file.txt"
 *
 * truncatePath('/short/path.txt', 30)
 * // "/short/path.txt"
 */
export function truncatePath(path: string, maxLength: number = 50): string {
  if (!path || path.length <= maxLength) {
    return path;
  }

  // Minimum viable truncation
  if (maxLength < 10) {
    return path.substring(0, maxLength - 3) + '...';
  }

  // Split path into segments
  const segments = path.split('/').filter(Boolean);

  if (segments.length <= 2) {
    // Simple truncation for short paths
    const keepLength = Math.floor((maxLength - 3) / 2);
    return path.substring(0, keepLength) + '...' + path.substring(path.length - keepLength);
  }

  // Keep first segment and last segment with filename
  const firstSegment = segments[0] ?? '';
  const lastSegment = segments[segments.length - 1] ?? '';

  // Calculate available space
  const separator = '/';
  const ellipsis = '...';
  const fixedLength = separator.length + ellipsis.length + separator.length + lastSegment.length;

  if (fixedLength >= maxLength) {
    // Just show truncated filename
    return ellipsis + separator + lastSegment.substring(0, maxLength - 4);
  }

  // Check if we can fit first segment
  const availableForFirst = maxLength - fixedLength;
  if (firstSegment.length <= availableForFirst) {
    return separator + firstSegment + separator + ellipsis + separator + lastSegment;
  }

  // Truncate first segment
  const truncatedFirst = firstSegment.substring(0, availableForFirst);
  return separator + truncatedFirst + separator + ellipsis + separator + lastSegment;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string like "2h 30m" or "45s"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) {
    return '-' + formatDuration(-ms);
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 && days === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.length > 0 ? parts.join(' ') : '0s';
}

/**
 * Format a number with thousand separators.
 *
 * @param num - The number to format
 * @returns Formatted number string with commas
 *
 * @example
 * formatNumber(1234567) // "1,234,567"
 */
export function formatNumber(num: number | bigint): string {
  return num.toLocaleString('en-US');
}

/**
 * Format a version number for display.
 *
 * @param version - The version number
 * @returns Formatted version string like "v1" or "v12"
 */
export function formatVersion(version: number): string {
  return `v${version}`;
}
