/**
 * Project list block builder
 * Builds the list of accessible projects for a user
 */

/**
 * Project info for list display
 */
export interface ProjectListItem {
  id: string;
  name: string;
  hubChannelId: string;
  fileCount: number;
  lastUpdated: Date;
  isOwner: boolean;
}

/**
 * Format date to relative time string
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Build project list blocks
 */
export function buildProjectListBlocks(
  projects: ProjectListItem[],
  currentUserId: string
): object[] {
  const blocks: object[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: ':file_cabinet: Your Projects',
      emoji: true,
    },
  });

  // Summary context
  const ownedCount = projects.filter(p => p.isOwner).length;
  const sharedCount = projects.length - ownedCount;

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${projects.length} project${projects.length === 1 ? '' : 's'} (${ownedCount} owned, ${sharedCount} shared)`,
      },
    ],
  });

  // Create new project button
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':heavy_plus_sign: Create Project', emoji: true },
        style: 'primary',
        action_id: 'create_project',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':arrows_counterclockwise: Refresh', emoji: true },
        action_id: 'refresh_projects',
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // Empty state
  if (projects.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':open_file_folder: *No projects yet*\n\nCreate your first project to start managing files with your team!',
      },
    });
    return blocks;
  }

  // Separate owned and shared projects
  const ownedProjects = projects.filter(p => p.isOwner);
  const sharedProjects = projects.filter(p => !p.isOwner);

  // Owned projects section
  if (ownedProjects.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':bust_in_silhouette: *Your Projects*',
      },
    });

    for (const project of ownedProjects) {
      blocks.push(...buildProjectItem(project));
    }
  }

  // Shared projects section
  if (sharedProjects.length > 0) {
    if (ownedProjects.length > 0) {
      blocks.push({ type: 'divider' });
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':busts_in_silhouette: *Shared with You*',
      },
    });

    for (const project of sharedProjects) {
      blocks.push(...buildProjectItem(project));
    }
  }

  // Footer
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Use `/files [project-name]` to browse files in a specific project.',
      },
    ],
  });

  return blocks;
}

/**
 * Build a single project item
 */
function buildProjectItem(project: ProjectListItem): object[] {
  const ownerBadge = project.isOwner ? ' :crown:' : '';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:file_cabinet: *${project.name}*${ownerBadge}\n${project.fileCount} file${project.fileCount === 1 ? '' : 's'} | Updated ${formatRelativeTime(project.lastUpdated)}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Open', emoji: true },
        action_id: 'open_project',
        value: project.id,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Hub: <#${project.hubChannelId}>`,
        },
      ],
    },
  ];
}

/**
 * Build project creation modal
 */
export function buildCreateProjectModal(): object {
  return {
    type: 'modal',
    callback_id: 'create_project_modal_submit',
    title: {
      type: 'plain_text',
      text: 'Create Project',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Create',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Create a new file hub project. A dedicated channel will be created for file management.',
        },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'project_name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'project_name_input',
          max_length: 80,
          placeholder: {
            type: 'plain_text',
            text: 'e.g., Marketing Assets, Product Designs',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Project Name',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'A descriptive name for your project.',
        },
      },
      {
        type: 'input',
        block_id: 'project_description_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'project_description_input',
          multiline: true,
          max_length: 500,
          placeholder: {
            type: 'plain_text',
            text: 'Describe what this project is for...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Description',
          emoji: true,
        },
      },
      {
        type: 'input',
        block_id: 'hub_channel_block',
        element: {
          type: 'channels_select',
          action_id: 'hub_channel_input',
          placeholder: {
            type: 'plain_text',
            text: 'Select a channel...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Hub Channel',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Select an existing channel to use as the file hub, or create a new one first.',
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':information_source: Only members of the hub channel will have access to project files.',
          },
        ],
      },
    ],
  };
}

/**
 * Build project settings modal
 */
export function buildProjectSettingsModal(
  project: ProjectListItem
): object {
  return {
    type: 'modal',
    callback_id: 'project_settings_modal_submit',
    private_metadata: JSON.stringify({ projectId: project.id }),
    title: {
      type: 'plain_text',
      text: 'Project Settings',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Save',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:file_cabinet: *${project.name}*`,
        },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'project_name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'project_name_input',
          initial_value: project.name,
          max_length: 80,
        },
        label: {
          type: 'plain_text',
          text: 'Project Name',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Hub Channel:* <#${project.hubChannelId}>`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':warning: The hub channel cannot be changed after project creation.',
          },
        ],
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Danger Zone*',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: ':wastebasket: Delete Project', emoji: true },
            style: 'danger',
            action_id: 'delete_project_confirm',
            value: project.id,
            confirm: {
              title: { type: 'plain_text', text: 'Delete Project?' },
              text: {
                type: 'mrkdwn',
                text: `Are you sure you want to delete *${project.name}*? This will delete all ${project.fileCount} file${project.fileCount === 1 ? '' : 's'} and cannot be undone.`,
              },
              confirm: { type: 'plain_text', text: 'Delete' },
              deny: { type: 'plain_text', text: 'Cancel' },
              style: 'danger',
            },
          },
        ],
      },
    ],
  };
}

/**
 * Build project created success message
 */
export function buildProjectCreatedBlocks(
  projectName: string,
  hubChannelId: string
): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':white_check_mark: *Project created successfully!*',
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Project:*\n${projectName}`,
        },
        {
          type: 'mrkdwn',
          text: `*Hub Channel:*\n<#${hubChannelId}>`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'You can now upload files to your project. Members of the hub channel will have access to all files.',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':heavy_plus_sign: Upload First File', emoji: true },
          style: 'primary',
          action_id: 'upload_new_file',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':mag: Open Hub', emoji: true },
          action_id: 'open_hub_channel',
          value: hubChannelId,
        },
      ],
    },
  ];
}

/**
 * Build project deleted confirmation
 */
export function buildProjectDeletedBlocks(projectName: string): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:wastebasket: *Project "${projectName}" has been deleted*`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'All files and version history have been removed.',
        },
      ],
    },
  ];
}

/**
 * Build no projects found message
 */
export function buildNoProjectsBlocks(): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':open_file_folder: *No projects found*\n\nYou don\'t have access to any file projects yet.',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':heavy_plus_sign: Create Your First Project', emoji: true },
          style: 'primary',
          action_id: 'create_project',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: ':bulb: Tip: Ask a team member to add you to an existing project\'s hub channel to gain access.',
        },
      ],
    },
  ];
}
