/**
 * Download Button Action Handlers
 *
 * Handles download-related button actions:
 * - file_download_{fileId} - Download only (no checkout)
 * - download_version_{fileId}_{version} - Download specific version
 * - ref_download_{fileId}_{version} - Download from reference card
 */

import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import type { FileService } from '../../services/file.service.js';
import type { UserService } from '../../services/user.service.js';
import type { AccessService } from '../../services/access.service.js';
import type { ProjectService } from '../../services/project.service.js';
import type { DownloadService } from '../../services/download.service.js';
import { FileNotFoundError, AccessDeniedError, VersionNotFoundError } from '../../utils/errors.js';

/**
 * Dependencies required by the download action handlers
 */
export interface DownloadActionDependencies {
  fileService: FileService;
  userService: UserService;
  accessService: AccessService;
  projectService: ProjectService;
  downloadService: DownloadService;
  downloadBaseUrl: string;
}

/**
 * Register download button action handlers
 */
export function registerDownloadActions(
  app: App,
  deps: DownloadActionDependencies
): void {
  // Handle "Download Only" button (no checkout, current version)
  app.action<BlockAction<ButtonAction>>(
    /^file_download_(.+)$/,
    async ({ action, body, ack, client }) => {
      await ack();

      try {
        // Extract fileId from action_id
        const match = action.action_id.match(/^file_download_(.+)$/);
        if (!match || !match[1]) {
          console.error('Invalid action_id format for download:', action.action_id);
          return;
        }

        const fileId: string = match[1];
        const slackUserId = body.user.id;
        const teamId = body.team?.id;
        const channelId = body.channel?.id;

        if (!teamId || !channelId) {
          console.error('Missing team or channel ID in download action');
          return;
        }

        await handleDownload(
          deps,
          client,
          channelId,
          slackUserId,
          teamId,
          fileId
        );
      } catch (error) {
        console.error('Error handling download action:', error);
        const channelId = body.channel?.id;
        const slackUserId = body.user.id;

        if (channelId) {
          await handleDownloadError(client, channelId, slackUserId, error);
        }
      }
    }
  );

  // Handle "Download Version" button (specific version)
  app.action<BlockAction<ButtonAction>>(
    /^download_version_(.+)_(\d+)$/,
    async ({ action, body, ack, client }) => {
      await ack();

      try {
        // Extract fileId and version from action_id
        const match = action.action_id.match(/^download_version_(.+)_(\d+)$/);
        if (!match || !match[1] || !match[2]) {
          console.error('Invalid action_id format for version download:', action.action_id);
          return;
        }

        const fileId: string = match[1];
        const versionNumber = parseInt(match[2], 10);
        const slackUserId = body.user.id;
        const teamId = body.team?.id;
        const channelId = body.channel?.id;

        if (!teamId || !channelId) {
          console.error('Missing team or channel ID in download version action');
          return;
        }

        await handleDownload(
          deps,
          client,
          channelId,
          slackUserId,
          teamId,
          fileId,
          versionNumber
        );
      } catch (error) {
        console.error('Error handling download version action:', error);
        const channelId = body.channel?.id;
        const slackUserId = body.user.id;

        if (channelId) {
          await handleDownloadError(client, channelId, slackUserId, error);
        }
      }
    }
  );

  // Handle reference card download button
  app.action<BlockAction<ButtonAction>>(
    /^ref_download_(.+)_(\d+)$/,
    async ({ action, body, ack, client }) => {
      await ack();

      try {
        // Extract fileId and version from action_id
        const match = action.action_id.match(/^ref_download_(.+)_(\d+)$/);
        if (!match || !match[1] || !match[2]) {
          console.error('Invalid action_id format for ref download:', action.action_id);
          return;
        }

        const fileId: string = match[1];
        const versionNumber = parseInt(match[2], 10);
        const slackUserId = body.user.id;
        const teamId = body.team?.id;
        const channelId = body.channel?.id;

        if (!teamId || !channelId) {
          console.error('Missing team or channel ID in ref download action');
          return;
        }

        await handleDownload(
          deps,
          client,
          channelId,
          slackUserId,
          teamId,
          fileId,
          versionNumber
        );
      } catch (error) {
        console.error('Error handling ref download action:', error);
        const channelId = body.channel?.id;
        const slackUserId = body.user.id;

        if (channelId) {
          await handleDownloadError(client, channelId, slackUserId, error);
        }
      }
    }
  );

  // Handle "View in Hub" button on reference cards
  app.action<BlockAction<ButtonAction>>(
    /^ref_view_hub_(.+)$/,
    async ({ ack }) => {
      // Just acknowledge - the button has a URL that handles navigation
      await ack();
    }
  );
}

/**
 * Handle download request for a file
 */
async function handleDownload(
  deps: DownloadActionDependencies,
  client: App['client'],
  channelId: string,
  slackUserId: string,
  teamId: string,
  fileId: string,
  versionNumber?: number
): Promise<void> {
  // Ensure user exists
  const user = await deps.userService.findOrCreateFromSlack(slackUserId, teamId);

  // Get file
  const file = await deps.fileService.findById(fileId);

  if (!file) {
    await postEphemeralError(client, channelId, slackUserId, ':x: File not found.');
    return;
  }

  // Get project and check access
  const project = await deps.projectService.findById(file.projectId);

  if (!project) {
    await postEphemeralError(client, channelId, slackUserId, ':x: Project not found.');
    return;
  }

  const hasAccess = await deps.accessService.canAccessProject(slackUserId, project);

  if (!hasAccess) {
    await postEphemeralError(
      client,
      channelId,
      slackUserId,
      `:lock: You don't have access to this project. Join <#${project.hubChannelId}> to access its files.`
    );
    return;
  }

  // Create download token
  const targetVersion = versionNumber ?? file.currentVersion;

  try {
    const token = await deps.downloadService.createDownloadToken(
      user.id,
      fileId,
      targetVersion
    );

    const downloadUrl = deps.downloadService.createDownloadUrl(
      token,
      deps.downloadBaseUrl
    );

    // Post ephemeral message with download link
    await client.chat.postEphemeral({
      channel: channelId,
      user: slackUserId,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:arrow_down: *Download: ${file.name}*`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Version: v${targetVersion}${targetVersion !== file.currentVersion ? ` (current is v${file.currentVersion})` : ''}`,
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Download',
            },
            url: downloadUrl,
            action_id: `download_link_${fileId}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: 'Link expires in 5 minutes. This is a read-only download - the file remains available for others.',
            },
          ],
        },
      ],
      text: `Download: ${file.name}`,
    });
  } catch (error) {
    if (error instanceof VersionNotFoundError) {
      await postEphemeralError(
        client,
        channelId,
        slackUserId,
        `:x: Version ${targetVersion} not found for this file.`
      );
      return;
    }
    throw error;
  }
}

/**
 * Handle download errors with appropriate messages
 */
async function handleDownloadError(
  client: App['client'],
  channelId: string,
  slackUserId: string,
  error: unknown
): Promise<void> {
  if (error instanceof FileNotFoundError) {
    await postEphemeralError(client, channelId, slackUserId, ':x: File not found.');
    return;
  }

  if (error instanceof AccessDeniedError) {
    await postEphemeralError(client, channelId, slackUserId, `:lock: ${error.message}`);
    return;
  }

  if (error instanceof VersionNotFoundError) {
    await postEphemeralError(
      client,
      channelId,
      slackUserId,
      `:x: Version not found for this file.`
    );
    return;
  }

  await postEphemeralError(
    client,
    channelId,
    slackUserId,
    `:x: An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`
  );
}

/**
 * Helper to post ephemeral error message
 */
async function postEphemeralError(
  client: App['client'],
  channelId: string,
  userId: string,
  message: string
): Promise<void> {
  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text: message,
  });
}
