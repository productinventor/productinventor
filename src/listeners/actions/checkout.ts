/**
 * Checkout Button Action Handler
 *
 * Handles the "Download & Check Out" button action from hub messages.
 * Pattern: /^file_checkout_(.+)$/
 *
 * Acquires lock on the file and provides download token.
 */

import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import type { FileService } from '../../services/file.service.js';
import type { UserService } from '../../services/user.service.js';
import type { AccessService } from '../../services/access.service.js';
import type { ProjectService } from '../../services/project.service.js';
import type { DownloadService } from '../../services/download.service.js';
import { FileLockedError, FileNotFoundError, AccessDeniedError } from '../../utils/errors.js';

/**
 * Dependencies required by the checkout action handler
 */
export interface CheckoutActionDependencies {
  fileService: FileService;
  userService: UserService;
  accessService: AccessService;
  projectService: ProjectService;
  downloadService: DownloadService;
  downloadBaseUrl: string;
}

/**
 * Register the checkout button action handler
 */
export function registerCheckoutAction(
  app: App,
  deps: CheckoutActionDependencies
): void {
  // Match action_id pattern: file_checkout_{fileId}
  app.action<BlockAction<ButtonAction>>(
    /^file_checkout_(.+)$/,
    async ({ action, body, ack, client }) => {
      await ack();

      try {
        // Extract fileId from action_id
        const match = action.action_id.match(/^file_checkout_(.+)$/);
        if (!match || !match[1]) {
          console.error('Invalid action_id format for checkout:', action.action_id);
          return;
        }

        const fileId: string = match[1];
        const slackUserId = body.user.id;
        const teamId = body.team?.id;
        const channelId = body.channel?.id;

        if (!teamId || !channelId) {
          console.error('Missing team or channel ID in checkout action');
          return;
        }

        // Ensure user exists
        const user = await deps.userService.findOrCreateFromSlack(slackUserId, teamId);

        // Get file to check access
        const file = await deps.fileService.findById(fileId);

        if (!file) {
          await postEphemeralError(client, channelId, slackUserId, 'File not found.');
          return;
        }

        // Get project and check access
        const project = await deps.projectService.findById(file.projectId);

        if (!project) {
          await postEphemeralError(client, channelId, slackUserId, 'Project not found.');
          return;
        }

        const hasAccess = await deps.accessService.canAccessProject(slackUserId, project);

        if (!hasAccess) {
          await postEphemeralError(
            client,
            channelId,
            slackUserId,
            `You don't have access to this project. Join <#${project.hubChannelId}> to access its files.`
          );
          return;
        }

        // Check out the file (acquires lock)
        const { file: checkedOutFile, filePath } = await deps.fileService.checkoutFile(
          fileId,
          user.id
        );

        // Create download token
        const token = await deps.downloadService.createDownloadToken(
          user.id,
          fileId,
          checkedOutFile.currentVersion
        );

        const downloadUrl = deps.downloadService.createDownloadUrl(
          token,
          deps.downloadBaseUrl
        );

        // Post ephemeral success message with download link
        await client.chat.postEphemeral({
          channel: channelId,
          user: slackUserId,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `:lock: *Checked out: ${checkedOutFile.name}*\n\nYou now have exclusive access to edit this file. Others will see it as locked until you check it back in.`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Download your file:*`,
              },
              accessory: {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Download',
                },
                url: downloadUrl,
                action_id: `checkout_download_${fileId}`,
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `v${checkedOutFile.currentVersion} | Link expires in 5 minutes | When done editing, use the "Check In" button`,
                },
              ],
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: 'Check In Updated File',
                  },
                  style: 'primary',
                  action_id: `file_checkin_${fileId}`,
                },
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: 'Cancel Checkout',
                  },
                  action_id: `file_cancel_checkout_${fileId}`,
                  confirm: {
                    title: {
                      type: 'plain_text',
                      text: 'Cancel Checkout?',
                    },
                    text: {
                      type: 'plain_text',
                      text: 'This will release the lock without uploading changes. Any edits will be lost.',
                    },
                    confirm: {
                      type: 'plain_text',
                      text: 'Cancel Checkout',
                    },
                    deny: {
                      type: 'plain_text',
                      text: 'Keep Lock',
                    },
                  },
                },
              ],
            },
          ],
          text: `Checked out: ${checkedOutFile.name}`,
        });
      } catch (error) {
        console.error('Error handling checkout action:', error);

        const channelId = body.channel?.id;
        const slackUserId = body.user.id;

        if (!channelId) return;

        if (error instanceof FileLockedError) {
          await postEphemeralError(
            client,
            channelId,
            slackUserId,
            `:lock: This file is currently checked out by <@${error.lockedByUserId}>. Please wait for them to check it back in.`
          );
          return;
        }

        if (error instanceof FileNotFoundError) {
          await postEphemeralError(client, channelId, slackUserId, ':x: File not found.');
          return;
        }

        if (error instanceof AccessDeniedError) {
          await postEphemeralError(client, channelId, slackUserId, `:lock: ${error.message}`);
          return;
        }

        await postEphemeralError(
          client,
          channelId,
          slackUserId,
          `:x: An error occurred while checking out the file: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
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
