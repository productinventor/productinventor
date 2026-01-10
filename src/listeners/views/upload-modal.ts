/**
 * Upload Modal View Submission Handler
 *
 * Handles the submission of the file upload modal.
 * - Handles new file upload to project
 * - Creates file and initial version
 * - Posts hub message for the new file
 */

import type { App } from '@slack/bolt';
import type { FileService } from '../../services/file.service.js';
import type { UserService } from '../../services/user.service.js';
import type { ProjectService } from '../../services/project.service.js';
import type { HubService } from '../../services/hub.service.js';
import { ProjectNotFoundError, AccessDeniedError } from '../../utils/errors.js';

/**
 * Dependencies required by the upload modal handler
 */
export interface UploadModalDependencies {
  fileService: FileService;
  userService: UserService;
  projectService: ProjectService;
  hubService: HubService;
  tempDir: string;
}

/**
 * Private metadata stored in the modal
 */
interface UploadModalMetadata {
  projectId?: string;
  channelId: string;
}

/**
 * File info from Slack upload
 */
interface SlackFileInfo {
  id: string;
  name: string;
  url_private_download: string;
  mimetype?: string;
}

/**
 * Register the upload modal submission handler
 */
export function registerUploadModalHandler(
  app: App,
  deps: UploadModalDependencies
): void {
  app.view('upload_file_modal', async ({ ack, body, view, client }) => {
    // Parse private metadata
    let metadata: UploadModalMetadata;
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

    const { channelId } = metadata;
    let projectId = metadata.projectId;
    const slackUserId = body.user.id;
    // Get team_id from the view body - it's nested in team
    const teamId = (body as { team?: { id: string } }).team?.id ?? '';

    // Extract form values using bracket notation for index signatures
    const values = view.state.values;

    // Get project ID from selector if not in metadata
    if (!projectId) {
      const projectInputBlock = values['project_input'];
      const projectInput = projectInputBlock?.['project'];
      projectId = (projectInput as { selected_option?: { value: string } })?.selected_option?.value;

      if (!projectId) {
        await ack({
          response_action: 'errors',
          errors: {
            project_input: 'Please select a project.',
          },
        });
        return;
      }
    }

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

    // Get optional path
    const filePathBlock = values['file_path_input'];
    const pathInput = filePathBlock?.['path'];
    const pathValue = (pathInput as { value?: string })?.value ?? '/';
    const filePath = normalizePath(pathValue);

    // Get optional message/description
    const messageInputBlock = values['message_input'];
    const messageInput = messageInputBlock?.['message'];
    const message = (messageInput as { value?: string })?.value;

    // Acknowledge the modal submission
    await ack();

    try {
      // Ensure user exists
      const user = await deps.userService.findOrCreateFromSlack(slackUserId, teamId);

      // Get project
      const project = await deps.projectService.findById(projectId);

      if (!project) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: slackUserId,
          text: ':x: Project not found. It may have been deleted.',
        });
        return;
      }

      // Check for duplicate file name
      const existingFile = await deps.fileService.findByNameInProject(
        uploadedFile.name,
        projectId
      );

      if (existingFile) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: slackUserId,
          text: `:warning: A file named "${uploadedFile.name}" already exists in this project.\n\nTo update it, check it out first and then check in the new version.`,
        });
        return;
      }

      // Download the file from Slack to temp storage
      const tempFilePath = await downloadSlackFile(
        client,
        uploadedFile.url_private_download,
        uploadedFile.name,
        deps.tempDir
      );

      try {
        // Create the file
        const createData: {
          projectId: string;
          name: string;
          path: string;
          mimeType: string;
          uploadedFilePath: string;
          uploadedById: string;
          message?: string;
        } = {
          projectId,
          name: uploadedFile.name,
          path: filePath,
          mimeType: uploadedFile.mimetype ?? 'application/octet-stream',
          uploadedFilePath: tempFilePath,
          uploadedById: user.id,
        };
        if (message) {
          createData.message = message;
        }
        const file = await deps.fileService.create(createData);

        // Update hub message for the new file
        await deps.hubService.updateHubMessage(file);

        // Post success message
        await client.chat.postEphemeral({
          channel: channelId,
          user: slackUserId,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `:white_check_mark: *Uploaded: ${file.name}*\n\nFile added to *${project.name}*${message ? `\n_"${message}"_` : ''}`,
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `v1 | Path: ${file.path} | <#${project.hubChannelId}>`,
                },
              ],
            },
          ],
          text: `Uploaded: ${file.name}`,
        });

        // Post activity to hub channel
        await client.chat.postMessage({
          channel: project.hubChannelId,
          thread_ts: file.hubMessageTs ?? undefined,
          text: `:new: <@${slackUserId}> uploaded ${file.name}${message ? `: ${message}` : ''}`,
        });
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
      console.error('Error handling upload modal submission:', error);

      let errorMessage = 'An unexpected error occurred while uploading the file.';

      if (error instanceof ProjectNotFoundError) {
        errorMessage = 'Project not found. It may have been deleted.';
      } else if (error instanceof AccessDeniedError) {
        errorMessage = 'You do not have permission to upload files to this project.';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Post error message to user
      await client.chat.postEphemeral({
        channel: channelId,
        user: slackUserId,
        text: `:x: Upload failed: ${errorMessage}`,
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

/**
 * Normalize a file path
 * - Ensure it starts with /
 * - Remove trailing slashes (except for root)
 * - Replace multiple slashes with single
 */
function normalizePath(inputPath: string): string {
  let path = inputPath.trim();

  // Default to root if empty
  if (!path) {
    return '/';
  }

  // Ensure starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  // Replace multiple slashes with single
  path = path.replace(/\/+/g, '/');

  // Remove trailing slash (except for root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}
