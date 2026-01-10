/**
 * Slack helper utilities for the file checkout system.
 *
 * Provides functions for building deep links, extracting IDs from action patterns,
 * parsing command text, and formatting user mentions.
 */

/**
 * Build a Slack deep link to a specific channel and optionally a message.
 *
 * @param channelId - The Slack channel ID
 * @param messageTs - Optional message timestamp to link to
 * @returns Deep link URL in slack:// format
 *
 * @example
 * buildDeepLink('C1234567890')
 * // "slack://channel?id=C1234567890"
 *
 * buildDeepLink('C1234567890', '1234567890.123456')
 * // "slack://channel?id=C1234567890&message=1234567890.123456"
 */
export function buildDeepLink(channelId: string, messageTs?: string): string {
  const baseUrl = `slack://channel?id=${channelId}`;

  if (messageTs) {
    return `${baseUrl}&message=${messageTs}`;
  }

  return baseUrl;
}

/**
 * Build a Slack deep link with team ID for cross-workspace links.
 *
 * @param teamId - The Slack team/workspace ID
 * @param channelId - The Slack channel ID
 * @param messageTs - Optional message timestamp to link to
 * @returns Deep link URL with team context
 *
 * @example
 * buildDeepLinkWithTeam('T1234567890', 'C1234567890')
 * // "slack://channel?team=T1234567890&id=C1234567890"
 */
export function buildDeepLinkWithTeam(
  teamId: string,
  channelId: string,
  messageTs?: string
): string {
  let url = `slack://channel?team=${teamId}&id=${channelId}`;

  if (messageTs) {
    url += `&message=${messageTs}`;
  }

  return url;
}

/**
 * Build a web link to a Slack channel/message.
 * Useful for environments where slack:// links don't work.
 *
 * @param domain - The Slack workspace domain (e.g., "mycompany")
 * @param channelId - The Slack channel ID
 * @param messageTs - Optional message timestamp to link to
 * @returns Web URL to the channel/message
 *
 * @example
 * buildWebLink('mycompany', 'C1234567890')
 * // "https://mycompany.slack.com/archives/C1234567890"
 */
export function buildWebLink(domain: string, channelId: string, messageTs?: string): string {
  let url = `https://${domain}.slack.com/archives/${channelId}`;

  if (messageTs) {
    // Convert message timestamp to URL format (replace . with empty)
    const formattedTs = `p${messageTs.replace('.', '')}`;
    url += `/${formattedTs}`;
  }

  return url;
}

/**
 * Extract a file ID from an action ID pattern.
 * Supports patterns like "file_checkout_abc123" or "file_download_abc123".
 *
 * @param actionId - The action ID string
 * @returns The extracted file ID or null if pattern doesn't match
 *
 * @example
 * extractFileId('file_checkout_abc123def456')
 * // "abc123def456"
 *
 * extractFileId('file_download_xyz789')
 * // "xyz789"
 *
 * extractFileId('invalid_action')
 * // null
 */
export function extractFileId(actionId: string): string | null {
  // Match patterns like: file_action_fileId
  const match = actionId.match(/^file_[a-z_]+_([a-zA-Z0-9]+)$/);

  if (match && match[1]) {
    return match[1];
  }

  // Also try ref_ patterns: ref_download_fileId_version
  const refMatch = actionId.match(/^ref_[a-z]+_([a-zA-Z0-9]+)(?:_\d+)?$/);

  if (refMatch && refMatch[1]) {
    return refMatch[1];
  }

  return null;
}

/**
 * Extract file ID and version from a reference action ID.
 *
 * @param actionId - The action ID string (e.g., "ref_download_abc123_2")
 * @returns Object with fileId and optional version, or null if pattern doesn't match
 *
 * @example
 * extractFileIdAndVersion('ref_download_abc123_2')
 * // { fileId: "abc123", version: 2 }
 *
 * extractFileIdAndVersion('ref_download_abc123')
 * // { fileId: "abc123", version: undefined }
 */
export function extractFileIdAndVersion(
  actionId: string
): { fileId: string; version?: number | undefined } | null {
  const match = actionId.match(/^ref_[a-z]+_([a-zA-Z0-9]+)(?:_(\d+))?$/);

  if (!match || !match[1]) {
    return null;
  }

  const result: { fileId: string; version?: number | undefined } = {
    fileId: match[1],
  };

  if (match[2]) {
    result.version = parseInt(match[2], 10);
  }

  return result;
}

/**
 * Parsed command arguments.
 */
export interface ParsedCommand {
  command: string;
  subcommand: string | null;
  args: string[];
  flags: Map<string, string | true>;
  rawArgs: string;
}

/**
 * Parse Slack slash command text into structured arguments.
 * Supports flags like --flag or --flag=value.
 *
 * @param text - The raw command text
 * @returns Parsed command structure
 *
 * @example
 * parseCommand('checkout "my file.txt" --force')
 * // {
 * //   command: 'checkout',
 * //   subcommand: null,
 * //   args: ['my file.txt'],
 * //   flags: Map { 'force' => true },
 * //   rawArgs: 'checkout "my file.txt" --force'
 * // }
 *
 * parseCommand('file list --project=abc123')
 * // {
 * //   command: 'file',
 * //   subcommand: 'list',
 * //   args: [],
 * //   flags: Map { 'project' => 'abc123' },
 * //   rawArgs: 'file list --project=abc123'
 * // }
 */
export function parseCommand(text: string): ParsedCommand {
  const rawArgs = text.trim();
  const tokens = tokenize(rawArgs);

  const result: ParsedCommand = {
    command: '',
    subcommand: null,
    args: [],
    flags: new Map(),
    rawArgs,
  };

  if (tokens.length === 0) {
    return result;
  }

  // First token is the command
  const firstToken = tokens[0];
  if (firstToken) {
    result.command = firstToken.toLowerCase();
  }

  // Process remaining tokens
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token.startsWith('--')) {
      // Flag: --name or --name=value
      const flagPart = token.substring(2);
      const equalsIndex = flagPart.indexOf('=');

      if (equalsIndex !== -1) {
        const name = flagPart.substring(0, equalsIndex);
        const value = flagPart.substring(equalsIndex + 1);
        result.flags.set(name, value);
      } else {
        result.flags.set(flagPart, true);
      }
    } else if (token.startsWith('-') && token.length === 2) {
      // Short flag: -f
      result.flags.set(token.substring(1), true);
    } else if (result.subcommand === null && !token.includes(' ') && i === 1) {
      // Second token (if not a flag) is the subcommand
      result.subcommand = token.toLowerCase();
    } else {
      // Regular argument
      result.args.push(token);
    }
  }

  return result;
}

/**
 * Tokenize a command string, respecting quoted strings.
 *
 * @param text - The text to tokenize
 * @returns Array of tokens
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (const char of text) {
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuotes) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Format a Slack user mention.
 *
 * @param slackUserId - The Slack user ID
 * @returns Formatted mention string like "<@U123>"
 *
 * @example
 * formatUserMention('U1234567890')
 * // "<@U1234567890>"
 */
export function formatUserMention(slackUserId: string): string {
  return `<@${slackUserId}>`;
}

/**
 * Format a Slack channel mention.
 *
 * @param channelId - The Slack channel ID
 * @returns Formatted channel mention string like "<#C123>"
 *
 * @example
 * formatChannelMention('C1234567890')
 * // "<#C1234567890>"
 */
export function formatChannelMention(channelId: string): string {
  return `<#${channelId}>`;
}

/**
 * Format a URL for Slack display with custom text.
 *
 * @param url - The URL
 * @param text - The display text
 * @returns Formatted link string like "<url|text>"
 *
 * @example
 * formatLink('https://example.com', 'Click here')
 * // "<https://example.com|Click here>"
 */
export function formatLink(url: string, text: string): string {
  return `<${url}|${text}>`;
}

/**
 * Escape special characters for Slack mrkdwn format.
 *
 * @param text - The text to escape
 * @returns Escaped text safe for Slack mrkdwn
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Extract user ID from a Slack mention.
 *
 * @param mention - The mention string (e.g., "<@U123>" or "@U123")
 * @returns The user ID or null if invalid
 *
 * @example
 * extractUserIdFromMention('<@U1234567890>')
 * // "U1234567890"
 *
 * extractUserIdFromMention('@U1234567890')
 * // "U1234567890"
 */
export function extractUserIdFromMention(mention: string): string | null {
  // Match <@U123> or <@U123|username> format
  const match = mention.match(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/);
  if (match && match[1]) {
    return match[1];
  }

  // Match plain @U123 format
  const plainMatch = mention.match(/^@?([UW][A-Z0-9]+)$/);
  if (plainMatch && plainMatch[1]) {
    return plainMatch[1];
  }

  return null;
}

/**
 * Extract channel ID from a Slack channel mention.
 *
 * @param mention - The mention string (e.g., "<#C123>" or "#C123")
 * @returns The channel ID or null if invalid
 *
 * @example
 * extractChannelIdFromMention('<#C1234567890|general>')
 * // "C1234567890"
 */
export function extractChannelIdFromMention(mention: string): string | null {
  // Match <#C123> or <#C123|channel-name> format
  const match = mention.match(/<#([CG][A-Z0-9]+)(?:\|[^>]+)?>/);
  if (match && match[1]) {
    return match[1];
  }

  // Match plain #C123 format
  const plainMatch = mention.match(/^#?([CG][A-Z0-9]+)$/);
  if (plainMatch && plainMatch[1]) {
    return plainMatch[1];
  }

  return null;
}

/**
 * Build an action ID with a prefix and data.
 *
 * @param prefix - The action prefix (e.g., "file_checkout")
 * @param ids - The IDs to append
 * @returns Combined action ID
 *
 * @example
 * buildActionId('file_checkout', 'abc123')
 * // "file_checkout_abc123"
 *
 * buildActionId('ref_download', 'abc123', '2')
 * // "ref_download_abc123_2"
 */
export function buildActionId(prefix: string, ...ids: (string | number)[]): string {
  return [prefix, ...ids].join('_');
}
