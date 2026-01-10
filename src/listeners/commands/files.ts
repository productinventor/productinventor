/**
 * /files Command Handler
 *
 * Handles the /files slash command with subcommands:
 * - /files init [name] - Initialize channel as project hub
 * - /files upload - Open upload modal
 * - /files (no args in hub) - List files
 * - /files (no args outside hub) - Show accessible projects
 */

import type { App, SlashCommand, RespondFn, AckFn, View, KnownBlock } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { ProjectService } from '../../services/project.service.js';
import type { FileService } from '../../services/file.service.js';
import type { UserService } from '../../services/user.service.js';
import type { AccessService } from '../../services/access.service.js';
import type { FileWithLock, ProjectWithFileCount } from '../../types/index.js';
import { ProjectAlreadyExistsError } from '../../utils/errors.js';

/**
 * Dependencies required by the files command handler
 */
export interface FilesCommandDependencies {
  projectService: ProjectService;
  fileService: FileService;
  userService: UserService;
  accessService: AccessService;
}

/**
 * Register the /files command handler
 */
export function registerFilesCommand(
  app: App,
  deps: FilesCommandDependencies
): void {
  app.command('/files', async ({ command, ack, respond, client }) => {
    await ack();

    try {
      const { text, user_id, team_id, channel_id } = command;
      const args = text.trim().split(/\s+/);
      const subcommand = args[0]?.toLowerCase() || '';

      // Ensure user exists
      const user = await deps.userService.findOrCreateFromSlack(user_id, team_id!);

      switch (subcommand) {
        case 'init':
          await handleInit(command, args, user.id, respond, client, deps);
          break;

        case 'upload':
          await handleUpload(command, client, deps);
          break;

        case 'help':
          await handleHelp(respond);
          break;

        default:
          // No subcommand - list files or show projects
          await handleList(command, user_id, respond, deps);
          break;
      }
    } catch (error) {
      console.error('Error handling /files command:', error);
      await respond({
        response_type: 'ephemeral',
        text: `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  });
}

/**
 * Handle /files init [name] - Initialize channel as project hub
 */
async function handleInit(
  command: SlashCommand,
  args: string[],
  userId: string,
  respond: RespondFn,
  client: WebClient,
  deps: FilesCommandDependencies
): Promise<void> {
  const { channel_id, team_id } = command;

  // Get project name from args or channel name
  let projectName = args.slice(1).join(' ').trim();

  if (!projectName) {
    // Try to get channel name from Slack
    try {
      const channelInfo = await client.conversations.info({ channel: channel_id });
      projectName = channelInfo.channel?.name || `Project ${channel_id.slice(-4)}`;
    } catch {
      projectName = `Project ${channel_id.slice(-4)}`;
    }
  }

  try {
    const project = await deps.projectService.create({
      name: projectName,
      slackTeamId: team_id!,
      hubChannelId: channel_id,
      createdById: userId,
    });

    await respond({
      response_type: 'in_channel',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:file_folder: *File Hub Initialized*\n\nThis channel is now a file hub for *${project.name}*.\n\nTeam members can:\n- Use \`/files upload\` to add files\n- Use \`/files\` to list all files\n- Use \`/share <filename>\` to share files to other channels`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Project ID: ${project.id} | Created by <@${command.user_id}>`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof ProjectAlreadyExistsError) {
      const existingProject = await deps.projectService.findByChannel(channel_id);
      await respond({
        response_type: 'ephemeral',
        text: `:warning: This channel is already a file hub for *${existingProject?.name || 'a project'}*.\n\nUse \`/files\` to see files or \`/files upload\` to add new ones.`,
      });
    } else {
      throw error;
    }
  }
}

/**
 * Handle /files upload - Open upload modal
 */
async function handleUpload(
  command: SlashCommand,
  client: WebClient,
  deps: FilesCommandDependencies
): Promise<void> {
  const { channel_id, trigger_id, user_id, team_id } = command;

  // Check if this channel is a project hub
  const project = await deps.projectService.findByChannel(channel_id);

  if (!project) {
    // Not a hub - need to select a project
    const projects = await deps.projectService.findAccessibleByUser(user_id);

    if (projects.length === 0) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: ':warning: You do not have access to any file hubs. Ask a team member to add you to a hub channel.',
      });
      return;
    }

    // Open modal with project selector
    await client.views.open({
      trigger_id,
      view: buildUploadModalWithProjectSelector(projects, channel_id) as View,
    });
  } else {
    // This is a hub - upload directly to this project
    const user = await deps.userService.findOrCreateFromSlack(user_id, team_id!);
    const hasAccess = await deps.accessService.canAccessProject(user_id, project);

    if (!hasAccess) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: ':lock: You do not have access to this file hub. Join the channel to access files.',
      });
      return;
    }

    // Open upload modal for this project
    await client.views.open({
      trigger_id,
      view: buildUploadModal(project.id, project.name, channel_id) as View,
    });
  }
}

/**
 * Handle /files (no args) - List files or show accessible projects
 */
async function handleList(
  command: SlashCommand,
  slackUserId: string,
  respond: RespondFn,
  deps: FilesCommandDependencies
): Promise<void> {
  const { channel_id } = command;

  // Check if this channel is a project hub
  const project = await deps.projectService.findByChannel(channel_id);

  if (project) {
    // This is a hub - list files
    const hasAccess = await deps.accessService.canAccessProject(slackUserId, project);

    if (!hasAccess) {
      await respond({
        response_type: 'ephemeral',
        text: ':lock: You do not have access to this file hub. Join the channel to access files.',
      });
      return;
    }

    const files = await deps.fileService.listByProject(project.id);

    if (files.length === 0) {
      await respond({
        response_type: 'ephemeral',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:file_folder: *${project.name}*\n\nNo files yet. Use \`/files upload\` to add the first file.`,
            },
          },
        ],
      });
      return;
    }

    await respond({
      response_type: 'ephemeral',
      blocks: buildFileListBlocks(project.name, files),
    });
  } else {
    // Not a hub - show accessible projects
    const projects = await deps.projectService.findAccessibleByUser(slackUserId);

    if (projects.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: ':file_folder: You do not have access to any file hubs yet.\n\nTo create a new hub, go to a channel and run `/files init`.',
      });
      return;
    }

    await respond({
      response_type: 'ephemeral',
      blocks: buildProjectListBlocks(projects),
    });
  }
}

/**
 * Handle /files help
 */
async function handleHelp(respond: RespondFn): Promise<void> {
  await respond({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*File Management Commands*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `\`/files\` - List files in current hub or show accessible projects
\`/files init [name]\` - Initialize this channel as a file hub
\`/files upload\` - Upload a new file
\`/share <filename>\` - Share a file to this channel
\`/share <project>:<filename>\` - Share from specific project`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Files are checked out for editing and checked back in with new versions. Only one person can edit at a time.',
          },
        ],
      },
    ],
  });
}

/**
 * Build blocks for file list display
 */
function buildFileListBlocks(projectName: string, files: FileWithLock[]): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:file_folder: *${projectName}* - ${files.length} file${files.length !== 1 ? 's' : ''}`,
      },
    },
    {
      type: 'divider',
    },
  ];

  for (const file of files) {
    const statusIcon = file.lock ? ':lock:' : ':white_check_mark:';
    const statusText = file.lock
      ? `Checked out by <@${file.lock.lockedBy.slackUserId}>`
      : 'Available';
    const sizeFormatted = formatFileSize(Number(file.sizeBytes));

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${statusIcon} *${file.name}*\nv${file.currentVersion} | ${sizeFormatted} | ${statusText}`,
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: file.lock ? 'View' : 'Check Out',
        },
        action_id: file.lock ? `file_view_${file.id}` : `file_checkout_${file.id}`,
      },
    } as KnownBlock);
  }

  return blocks;
}

/**
 * Build blocks for project list display
 */
function buildProjectListBlocks(projects: ProjectWithFileCount[]): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:file_folder: *Your File Hubs* - ${projects.length} project${projects.length !== 1 ? 's' : ''}`,
      },
    },
    {
      type: 'divider',
    },
  ];

  for (const project of projects) {
    const fileCount = project._count.files;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${project.name}*\n${fileCount} file${fileCount !== 1 ? 's' : ''} | <#${project.hubChannelId}>`,
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Files',
        },
        action_id: `project_view_${project.id}`,
      },
    } as KnownBlock);
  }

  return blocks;
}

/**
 * Build upload modal for direct project upload
 */
function buildUploadModal(
  projectId: string,
  projectName: string,
  channelId: string
): object {
  return {
    type: 'modal',
    callback_id: 'upload_file_modal',
    private_metadata: JSON.stringify({ projectId, channelId }),
    title: {
      type: 'plain_text',
      text: 'Upload File',
    },
    submit: {
      type: 'plain_text',
      text: 'Upload',
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
          text: `Uploading to *${projectName}*`,
        },
      },
      {
        type: 'input',
        block_id: 'file_input',
        label: {
          type: 'plain_text',
          text: 'File',
        },
        element: {
          type: 'file_input',
          action_id: 'file',
          filetypes: ['all'],
          max_files: 1,
        },
      },
      {
        type: 'input',
        block_id: 'file_path_input',
        optional: true,
        label: {
          type: 'plain_text',
          text: 'Path (optional)',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'path',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., /designs/assets',
          },
        },
        hint: {
          type: 'plain_text',
          text: 'Optional folder path for organizing files',
        },
      },
      {
        type: 'input',
        block_id: 'message_input',
        optional: true,
        label: {
          type: 'plain_text',
          text: 'Description',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'message',
          placeholder: {
            type: 'plain_text',
            text: 'Brief description of this file',
          },
        },
      },
    ],
  };
}

/**
 * Build upload modal with project selector
 */
function buildUploadModalWithProjectSelector(
  projects: ProjectWithFileCount[],
  channelId: string
): object {
  const projectOptions = projects.map((p) => ({
    text: {
      type: 'plain_text',
      text: p.name,
    },
    value: p.id,
  }));

  return {
    type: 'modal',
    callback_id: 'upload_file_modal',
    private_metadata: JSON.stringify({ channelId }),
    title: {
      type: 'plain_text',
      text: 'Upload File',
    },
    submit: {
      type: 'plain_text',
      text: 'Upload',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'project_input',
        label: {
          type: 'plain_text',
          text: 'Project',
        },
        element: {
          type: 'static_select',
          action_id: 'project',
          placeholder: {
            type: 'plain_text',
            text: 'Select a project',
          },
          options: projectOptions,
        },
      },
      {
        type: 'input',
        block_id: 'file_input',
        label: {
          type: 'plain_text',
          text: 'File',
        },
        element: {
          type: 'file_input',
          action_id: 'file',
          filetypes: ['all'],
          max_files: 1,
        },
      },
      {
        type: 'input',
        block_id: 'file_path_input',
        optional: true,
        label: {
          type: 'plain_text',
          text: 'Path (optional)',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'path',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., /designs/assets',
          },
        },
        hint: {
          type: 'plain_text',
          text: 'Optional folder path for organizing files',
        },
      },
      {
        type: 'input',
        block_id: 'message_input',
        optional: true,
        label: {
          type: 'plain_text',
          text: 'Description',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'message',
          placeholder: {
            type: 'plain_text',
            text: 'Brief description of this file',
          },
        },
      },
    ],
  };
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
