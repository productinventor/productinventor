/**
 * Check-in Modal View Submission Handler
 *
 * Handles the submission of the check-in modal.
 * - Extracts uploaded file from form
 * - Gets version notes from input
 * - Calls fileService.checkinFile()
 * - Updates hub and reference cards
 */

import type { App } from '@slack/bolt';
import type { FileService } from '../../services/file.service.js';
import type { UserService } from '../../services/user.service.js';
import type { HubService } from '../../services/hub.service.js';
import type { ReferenceService } from '../../services/reference.service.js';
import { FileNotFoundError, UnauthorizedError } from '../../utils/errors.js';

/**
 * Dependencies required by the checkin modal handler
 */
export interface CheckinModalDependencies {
  fileService: FileService;
  userService: UserService;
  hubService: HubService;
  referenceService: ReferenceService;
  tempDir: string;
}

/**
 * Private metadata stored in the modal
 */
interface CheckinModalMetadata {
  fileId: string;
  channelId: string;
}

/**
 * File info from Slack upload
 */
interface SlackFileInfo {
  id: string;
  name: string;
  url_private_download: string;
}

/**
 * Register the check-in modal submission handler
 */
export function registerCheckinModalHandler(
  app: App,
  deps: CheckinModalDependencies
): void {
  app.view('checkin_file_modal', async ({ ack, body, view, client }) => {
    // Parse private metadata
    let metadata: CheckinModalMetadata;
    try {
      metadata = JSON.parse(view.private_metadata);
    } catch {
      await ack({
        response_action: 'errors',
        errors: {
          file_input: 'Invalid modal state. Please try again.',
        },
      });
      return;
    }

    const { fileId, channelId } = metadata;
    const slackUserId = body.user.id;
    // Get team_id from the view body - it's nested in team
    const teamId = (body as { team?: { id: string } }).team?.id ?? '';

    // Extract form values using bracket notation for index signatures
    const values = view.state.values;

    // Get uploaded file info
    const fileInputBlock = values['file_input'];
    const fileInput = fileInputBlock?.['file'];
    const files = (fileInput as { files?: SlackFileInfo[] })?.files;

    if (!files || files.length === 0) {
      await ack({
        response_action: 'errors',
        errors: {
          file_input: 'Please upload a file.',
        },
      });
      return;
    }

    const uploadedFile = files[0];
    if (!uploadedFile) {
      await ack({
        response_action: 'errors',
        errors: {
          file_input: 'Please upload a file.',
        },
      });
      return;
    }

    // Get version notes
    const messageInputBlock = values['message_input'];
    const messageInput = messageInputBlock?.['message'];
    const message = (messageInput as { value?: string })?.value;

    // Acknowledge the modal submission
    await ack();

    try {
      // Ensure user exists
      const user = await deps.userService.findOrCreateFromSlack(slackUserId, teamId);

      // Download the file from Slack to temp storage
      const tempFilePath = await downloadSlackFile(
        client,
        uploadedFile.url_private_download,
        uploadedFile.name,
        deps.tempDir
      );

      try {
        // Check in the file
        const { file, version } = await deps.fileService.checkinFile(
          fileId,
          user.id,
          tempFilePath,
          message
        );

        // Update hub message and references (already done by fileService, but ensure it's complete)
        await deps.hubService.updateHubMessage(file);
        await deps.referenceService.updateAllReferences(fileId);

        // Post success message to channel
        await client.chat.postEphemeral({
          channel: channelId,
          user: slackUserId,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `:white_check_mark: *Checked in: ${file.name}*\n\nNew version: v${version.versionNumber}${message ? `\n_"${message}"_` : ''}`,
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'The file is now unlocked and available for others to check out.',
                },
              ],
            },
          ],
          text: `Checked in: ${file.name} v${version.versionNumber}`,
        });

        // Also post activity to hub thread
        await deps.hubService.postActivity(
          file,
          `:inbox_tray: <@${slackUserId}> checked in v${version.versionNumber}${message ? `: ${message}` : ''}`
        );
      } finally {
        // Clean up temp file
        try {
          const fs = await import('fs/promises');
          await fs.unlink(tempFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      console.error('Error handling checkin modal submission:', error);

      let errorMessage = 'An unexpected error occurred while checking in the file.';

      if (error instanceof FileNotFoundError) {
        errorMessage = 'File not found. It may have been deleted.';
      } else if (error instanceof UnauthorizedError) {
        errorMessage = 'You are not authorized to check in this file. You must have it checked out.';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Post error message to user
      await client.chat.postEphemeral({
        channel: channelId,
        user: slackUserId,
        text: `:x: Check-in failed: ${errorMessage}`,
      });
    }
  });
}

/**
 * Download a file from Slack to local temp storage
 */
async function downloadSlackFile(
  client: App['client'],
  url: string,
  fileName: string,
  tempDir: string
): Promise<string> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const crypto = await import('crypto');

  // Create temp directory if it doesn't exist
  await fs.mkdir(tempDir, { recursive: true });

  // Generate unique temp filename
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const tempFilePath = path.join(tempDir, `${uniqueId}_${fileName}`);

  // Fetch file from Slack
  // The url_private_download requires authentication via token
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${(client as unknown as { token?: string }).token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file from Slack: ${response.status} ${response.statusText}`);
  }

  // Write to temp file
  const buffer = await response.arrayBuffer();
  await fs.writeFile(tempFilePath, Buffer.from(buffer));

  return tempFilePath;
}
