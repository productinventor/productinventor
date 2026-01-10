/**
 * Check-in Action Handler
 *
 * Handles check-in related button actions:
 * - file_checkin_{fileId} - Open check-in modal
 * - file_cancel_checkout_{fileId} - Cancel checkout and release lock
 */

import type { App, BlockAction, ButtonAction, View } from '@slack/bolt';
import type { FileService } from '../../services/file.service.js';
import type { UserService } from '../../services/user.service.js';
import type { LockService } from '../../services/lock.service.js';
import type { HubService } from '../../services/hub.service.js';
import type { ReferenceService } from '../../services/reference.service.js';
import { FileNotFoundError, UnauthorizedError, LockNotFoundError } from '../../utils/errors.js';

/**
 * Dependencies required by the checkin action handlers
 */
export interface CheckinActionDependencies {
  fileService: FileService;
  userService: UserService;
  lockService: LockService;
  hubService: HubService;
  referenceService: ReferenceService;
}

/**
 * Register the checkin and cancel checkout action handlers
 */
export function registerCheckinActions(
  app: App,
  deps: CheckinActionDependencies
): void {
  // Handle check-in button click - opens modal
  app.action<BlockAction<ButtonAction>>(
    /^file_checkin_(.+)$/,
    async ({ action, body, ack, client }) => {
      await ack();

      try {
        // Extract fileId from action_id
        const match = action.action_id.match(/^file_checkin_(.+)$/);
        if (!match || !match[1]) {
          console.error('Invalid action_id format for checkin:', action.action_id);
          return;
        }

        const fileId: string = match[1];
        const slackUserId = body.user.id;
        const teamId = body.team?.id;
        const channelId = body.channel?.id;

        if (!teamId || !channelId) {
          console.error('Missing team or channel ID in checkin action');
          return;
        }

        // Ensure user exists and get user ID
        const user = await deps.userService.findOrCreateFromSlack(slackUserId, teamId);

        // Get file with lock info
        const file = await deps.fileService.findById(fileId);

        if (!file) {
          await postEphemeralError(client, channelId, slackUserId, 'File not found.');
          return;
        }

        // Verify user holds the lock
        if (!file.lock || file.lock.lockedById !== user.id) {
          await postEphemeralError(
            client,
            channelId,
            slackUserId,
            ':x: You do not have this file checked out. Only the person who checked it out can check it in.'
          );
          return;
        }

        // Open check-in modal
        const triggerId = (body as { trigger_id?: string }).trigger_id;
        if (!triggerId) {
          console.error('Missing trigger_id in checkin action');
          return;
        }
        await client.views.open({
          trigger_id: triggerId,
          view: buildCheckinModal(fileId, file.name, file.currentVersion, channelId) as View,
        });
      } catch (error) {
        console.error('Error handling checkin action:', error);

        const channelId = body.channel?.id;
        const slackUserId = body.user.id;

        if (!channelId) return;

        await postEphemeralError(
          client,
          channelId,
          slackUserId,
          `:x: An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  );

  // Handle cancel checkout button click
  app.action<BlockAction<ButtonAction>>(
    /^file_cancel_checkout_(.+)$/,
    async ({ action, body, ack, client }) => {
      await ack();

      try {
        // Extract fileId from action_id
        const match = action.action_id.match(/^file_cancel_checkout_(.+)$/);
        if (!match || !match[1]) {
          console.error('Invalid action_id format for cancel checkout:', action.action_id);
          return;
        }

        const fileId: string = match[1];
        const slackUserId = body.user.id;
        const teamId = body.team?.id;
        const channelId = body.channel?.id;

        if (!teamId || !channelId) {
          console.error('Missing team or channel ID in cancel checkout action');
          return;
        }

        // Ensure user exists and get user ID
        const user = await deps.userService.findOrCreateFromSlack(slackUserId, teamId);

        // Get file with lock info
        const file = await deps.fileService.findById(fileId);

        if (!file) {
          await postEphemeralError(client, channelId, slackUserId, 'File not found.');
          return;
        }

        // Verify user holds the lock
        if (!file.lock || file.lock.lockedById !== user.id) {
          await postEphemeralError(
            client,
            channelId,
            slackUserId,
            ':x: You do not have this file checked out.'
          );
          return;
        }

        // Release the lock
        await deps.lockService.releaseLock(fileId, user.id);

        // Refresh file and update hub message
        const updatedFile = await deps.fileService.findById(fileId);
        if (updatedFile) {
          await deps.hubService.updateHubMessage(updatedFile);
          await deps.referenceService.updateAllReferences(fileId);
        }

        // Confirm to user
        await client.chat.postEphemeral({
          channel: channelId,
          user: slackUserId,
          text: `:white_check_mark: Checkout cancelled for *${file.name}*. The file is now available for others to check out.`,
        });
      } catch (error) {
        console.error('Error handling cancel checkout action:', error);

        const channelId = body.channel?.id;
        const slackUserId = body.user.id;

        if (!channelId) return;

        if (error instanceof UnauthorizedError) {
          await postEphemeralError(
            client,
            channelId,
            slackUserId,
            ':x: You are not authorized to cancel this checkout.'
          );
          return;
        }

        if (error instanceof LockNotFoundError) {
          await postEphemeralError(
            client,
            channelId,
            slackUserId,
            ':information_source: This file is not currently checked out.'
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
    }
  );
}

/**
 * Build the check-in modal view
 */
function buildCheckinModal(
  fileId: string,
  fileName: string,
  currentVersion: number,
  channelId: string
): object {
  return {
    type: 'modal',
    callback_id: 'checkin_file_modal',
    private_metadata: JSON.stringify({ fileId, channelId }),
    title: {
      type: 'plain_text',
      text: 'Check In File',
    },
    submit: {
      type: 'plain_text',
      text: 'Check In',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${fileName}*\nCurrent version: v${currentVersion}\nNew version: v${currentVersion + 1}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'input',
        block_id: 'file_input',
        label: {
          type: 'plain_text',
          text: 'Updated File',
        },
        element: {
          type: 'file_input',
          action_id: 'file',
          filetypes: ['all'],
          max_files: 1,
        },
        hint: {
          type: 'plain_text',
          text: 'Upload the updated version of the file',
        },
      },
      {
        type: 'input',
        block_id: 'message_input',
        optional: true,
        label: {
          type: 'plain_text',
          text: 'Version Notes',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'message',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Describe what changed in this version...',
          },
        },
        hint: {
          type: 'plain_text',
          text: 'Optional notes about the changes in this version',
        },
      },
    ],
  };
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
