/**
 * Access denied card block builder
 * Builds access denied messages for unauthorized users
 */

/**
 * File info for access denied card
 */
export interface AccessDeniedFileInfo {
  name: string;
  path: string;
  projectName: string;
}

/**
 * Project owner info
 */
export interface ProjectOwnerInfo {
  slackUserId: string;
  displayName: string;
}

/**
 * Build blocks for access denied card
 */
export function buildAccessDeniedBlocks(
  fileInfo?: AccessDeniedFileInfo,
  projectOwner?: ProjectOwnerInfo
): object[] {
  const blocks: object[] = [];

  // Warning header
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: ':no_entry: *Access Denied*',
    },
  });

  // Main message
  if (fileInfo) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `You don't have access to the file *${fileInfo.name}* in the *${fileInfo.projectName}* project.\n\nThis file is confidential and restricted to authorized team members.`,
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'You don\'t have access to this project.\n\nThis content is confidential and restricted to authorized team members.',
      },
    });
  }

  // Contact owner section
  if (projectOwner) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Contact <@${projectOwner.slackUserId}> to request access.`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: ':envelope: Request Access', emoji: true },
        action_id: 'request_project_access',
        value: JSON.stringify({
          ownerId: projectOwner.slackUserId,
          projectName: fileInfo?.projectName,
        }),
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Contact the file owner for access.',
      },
    });
  }

  // Help context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: ':question: Need help? Use `/files help` for more information.',
      },
    ],
  });

  return blocks;
}

/**
 * Build blocks for project not found error
 */
export function buildProjectNotFoundBlocks(projectName?: string): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':warning: *Project Not Found*',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: projectName
          ? `The project *${projectName}* could not be found. It may have been deleted or you may not have access.`
          : 'The requested project could not be found. It may have been deleted or you may not have access.',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':mag: Browse Projects', emoji: true },
          action_id: 'browse_projects',
        },
      ],
    },
  ];
}

/**
 * Build blocks for file not found error
 */
export function buildFileNotFoundBlocks(fileName?: string): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':warning: *File Not Found*',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: fileName
          ? `The file *${fileName}* could not be found. It may have been deleted or moved.`
          : 'The requested file could not be found. It may have been deleted or moved.',
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Use `/files` to browse available files in your projects.',
        },
      ],
    },
  ];
}

/**
 * Build blocks for expired lock error
 */
export function buildLockExpiredBlocks(
  fileName: string,
  currentLockHolder?: { slackUserId: string; displayName: string }
): object[] {
  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':warning: *Lock Expired*',
      },
    },
  ];

  if (currentLockHolder) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Your lock on *${fileName}* has expired. The file is now checked out by <@${currentLockHolder.slackUserId}>.`,
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Your lock on *${fileName}* has expired. The file is now available for checkout.`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: ':bulb: Tip: Check out files again before making changes to ensure you have the latest version.',
      },
    ],
  });

  return blocks;
}

/**
 * Build blocks for already locked error
 */
export function buildAlreadyLockedBlocks(
  fileName: string,
  lockHolder: { slackUserId: string; displayName: string },
  lockedAt: Date
): object[] {
  const lockedDuration = Math.floor((Date.now() - lockedAt.getTime()) / (1000 * 60));
  let durationText: string;

  if (lockedDuration < 60) {
    durationText = `${lockedDuration} minute${lockedDuration === 1 ? '' : 's'}`;
  } else if (lockedDuration < 1440) {
    const hours = Math.floor(lockedDuration / 60);
    durationText = `${hours} hour${hours === 1 ? '' : 's'}`;
  } else {
    const days = Math.floor(lockedDuration / 1440);
    durationText = `${days} day${days === 1 ? '' : 's'}`;
  }

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':lock: *File Currently Checked Out*',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${fileName}* is currently checked out by <@${lockHolder.slackUserId}>.\n\nThey have had the file for ${durationText}.`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':raised_hand: Request Access', emoji: true },
          style: 'primary',
          action_id: 'request_file_access',
          value: JSON.stringify({ lockHolderId: lockHolder.slackUserId, fileName }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: ':arrow_down: Download Current Version', emoji: true },
          action_id: 'download_current_version',
        },
      ],
    },
  ];
}

/**
 * Build blocks for generic error
 */
export function buildErrorBlocks(
  title: string,
  message: string,
  showRetry: boolean = true
): object[] {
  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:x: *${title}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message,
      },
    },
  ];

  if (showRetry) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'If this problem persists, please contact support.',
        },
      ],
    });
  }

  return blocks;
}
