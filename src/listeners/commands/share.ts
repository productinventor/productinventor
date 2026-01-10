/**
 * /share Command Handler
 *
 * Handles the /share slash command for sharing files:
 * - /share <filename> - Share file to current channel
 * - /share <project>:<filename> - Share file from specific project
 *
 * Supports sharing in threads via command.thread_ts
 */

import type { App, SlashCommand, RespondFn } from '@slack/bolt';
import type { FileService } from '../../services/file.service.js';
import type { ReferenceService } from '../../services/reference.service.js';
import type { AccessService } from '../../services/access.service.js';
import type { ProjectService } from '../../services/project.service.js';
import type { UserService } from '../../services/user.service.js';
import { AccessDeniedError, FileNotFoundError } from '../../utils/errors.js';

/**
 * Dependencies required by the share command handler
 */
export interface ShareCommandDependencies {
  fileService: FileService;
  referenceService: ReferenceService;
  accessService: AccessService;
  projectService: ProjectService;
  userService: UserService;
}

/**
 * Register the /share command handler
 */
export function registerShareCommand(
  app: App,
  deps: ShareCommandDependencies
): void {
  app.command('/share', async ({ command, ack, respond, client }) => {
    await ack();

    try {
      const { text, user_id, team_id, channel_id } = command;
      // Get thread_ts if the command was invoked in a thread
      const threadTs = (command as SlashCommand & { thread_ts?: string }).thread_ts;

      if (!text.trim()) {
        await respond({
          response_type: 'ephemeral',
          text: ':information_source: *Usage:*\n`/share <filename>` - Share a file to this channel\n`/share <project>:<filename>` - Share from a specific project',
        });
        return;
      }

      // Ensure user exists
      const user = await deps.userService.findOrCreateFromSlack(user_id, team_id!);

      // Parse the share target
      const { projectName, fileName } = parseShareTarget(text.trim());

      // Find the file
      let file;
      let project;

      if (projectName) {
        // Explicit project specified
        project = await deps.projectService.findByName(projectName, team_id);

        if (!project) {
          await respond({
            response_type: 'ephemeral',
            text: `:x: Project "${projectName}" not found.`,
          });
          return;
        }

        // Check access
        const hasAccess = await deps.accessService.canAccessProject(user_id, project);
        if (!hasAccess) {
          await respond({
            response_type: 'ephemeral',
            text: `:lock: You don't have access to project "${projectName}". Join <#${project.hubChannelId}> to access its files.`,
          });
          return;
        }

        file = await deps.fileService.findByNameInProject(fileName, project.id);

        if (!file) {
          await respond({
            response_type: 'ephemeral',
            text: `:x: File "${fileName}" not found in project "${projectName}".`,
          });
          return;
        }
      } else {
        // No project specified - search accessible projects
        const accessibleProjects = await deps.projectService.findAccessibleByUser(user_id);

        if (accessibleProjects.length === 0) {
          await respond({
            response_type: 'ephemeral',
            text: ':warning: You do not have access to any file hubs. Ask a team member to add you to a hub channel.',
          });
          return;
        }

        const projectIds = accessibleProjects.map((p) => p.id);
        file = await deps.fileService.findByNameWithAccess(fileName, projectIds);

        if (!file) {
          await respond({
            response_type: 'ephemeral',
            text: `:x: File "${fileName}" not found in any of your accessible projects.\n\nTip: Use \`/share project:filename\` to specify a project.`,
          });
          return;
        }

        project = await deps.projectService.findById(file.projectId);
      }

      if (!project) {
        await respond({
          response_type: 'ephemeral',
          text: ':x: Could not find the project for this file.',
        });
        return;
      }

      // Check if user can share to this channel
      const canShare = await deps.accessService.canShareToChannel(
        user_id,
        project,
        channel_id
      );

      if (!canShare) {
        await respond({
          response_type: 'ephemeral',
          text: ':lock: You cannot share files to this channel. You need access to both the source project and this channel.',
        });
        return;
      }

      // Create the reference card
      const reference = await deps.referenceService.shareFile(
        file.id,
        user.id,
        channel_id,
        threadTs
      );

      // Confirm to the user (ephemeral)
      await respond({
        response_type: 'ephemeral',
        text: `:white_check_mark: Shared *${file.name}* (v${file.currentVersion}) from *${project.name}*.`,
      });
    } catch (error) {
      console.error('Error handling /share command:', error);

      if (error instanceof AccessDeniedError) {
        await respond({
          response_type: 'ephemeral',
          text: `:lock: ${error.message}`,
        });
        return;
      }

      if (error instanceof FileNotFoundError) {
        await respond({
          response_type: 'ephemeral',
          text: `:x: ${error.message}`,
        });
        return;
      }

      await respond({
        response_type: 'ephemeral',
        text: `:x: An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  });
}

/**
 * Parse the share target string into project name and file name
 *
 * Formats:
 * - "filename" -> { projectName: undefined, fileName: "filename" }
 * - "project:filename" -> { projectName: "project", fileName: "filename" }
 * - "Project Name:filename.ext" -> { projectName: "Project Name", fileName: "filename.ext" }
 */
function parseShareTarget(input: string): { projectName?: string; fileName: string } {
  // Check for project:filename format
  // We need to be careful with filenames that might contain colons
  // Strategy: If there's a colon, the part before it is the project name
  // unless the colon is part of a Windows path (like C:), which we don't support anyway

  const colonIndex = input.indexOf(':');

  if (colonIndex > 0 && colonIndex < input.length - 1) {
    // Colon found, not at start or end
    const projectName = input.slice(0, colonIndex).trim();
    const fileName = input.slice(colonIndex + 1).trim();

    // Make sure we have valid parts
    if (projectName && fileName) {
      return { projectName, fileName };
    }
  }

  // No valid colon format - treat entire string as filename
  return { fileName: input.trim() };
}
