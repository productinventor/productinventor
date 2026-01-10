/**
 * Check-in modal block builder
 * Builds the modal for checking in a file with new version
 */

/**
 * File info for check-in modal
 */
export interface CheckinFileInfo {
  id: string;
  name: string;
  path: string;
  currentVersion: number;
  mimeType: string;
  projectId: string;
  projectName: string;
}

/**
 * Build check-in modal view
 */
export function buildCheckinModal(file: CheckinFileInfo): object {
  return {
    type: 'modal',
    callback_id: 'checkin_modal_submit',
    private_metadata: JSON.stringify({
      fileId: file.id,
      projectId: file.projectId,
    }),
    title: {
      type: 'plain_text',
      text: 'Check In File',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Check In',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      // File info section
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:page_facing_up: *${file.name}*\n\`${file.path}\``,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Current version: v${file.currentVersion} | Project: ${file.projectName}`,
          },
        ],
      },
      {
        type: 'divider',
      },
      // Info about what will happen
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:information_source: Checking in will:\n- Create version *v${file.currentVersion + 1}*\n- Release your lock on the file\n- Notify channels with references to this file`,
        },
      },
      {
        type: 'divider',
      },
      // File upload input
      {
        type: 'input',
        block_id: 'file_upload_block',
        element: {
          type: 'file_input',
          action_id: 'file_upload_input',
          max_files: 1,
          filetypes: getAllowedFileTypes(file.mimeType),
        },
        label: {
          type: 'plain_text',
          text: 'Upload Updated File',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Select the updated version of your file to upload.',
        },
      },
      // Version notes input (optional)
      {
        type: 'input',
        block_id: 'version_notes_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'version_notes_input',
          multiline: true,
          max_length: 500,
          placeholder: {
            type: 'plain_text',
            text: 'Describe what changed in this version...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Version Notes',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Optional: Add notes about what changed in this version.',
        },
      },
    ],
  };
}

/**
 * Build check-in without changes modal (just release lock)
 */
export function buildReleaseLockModal(file: CheckinFileInfo): object {
  return {
    type: 'modal',
    callback_id: 'release_lock_modal_submit',
    private_metadata: JSON.stringify({
      fileId: file.id,
      projectId: file.projectId,
    }),
    title: {
      type: 'plain_text',
      text: 'Release Lock',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Release Lock',
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
          text: `:page_facing_up: *${file.name}*\n\`${file.path}\``,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Current version: v${file.currentVersion}`,
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':warning: *Release without changes?*\n\nThis will release your lock on the file without uploading a new version. The file will remain at v' + file.currentVersion + '.',
        },
      },
      {
        type: 'input',
        block_id: 'release_reason_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'release_reason_input',
          max_length: 200,
          placeholder: {
            type: 'plain_text',
            text: 'Reason for releasing without changes...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Reason (optional)',
          emoji: true,
        },
      },
    ],
  };
}

/**
 * Build check-in confirmation modal
 */
export function buildCheckinConfirmationModal(
  file: CheckinFileInfo,
  newVersion: number,
  uploadedFileName: string
): object {
  return {
    type: 'modal',
    callback_id: 'checkin_confirmation_close',
    title: {
      type: 'plain_text',
      text: 'Check In Complete',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Done',
      emoji: true,
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':white_check_mark: *File checked in successfully!*',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*File:*\n${file.name}`,
          },
          {
            type: 'mrkdwn',
            text: `*New Version:*\nv${newVersion}`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Uploaded: ${uploadedFileName}`,
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'The file is now available for others to check out. Reference cards in other channels will be updated.',
        },
      },
    ],
  };
}

/**
 * Get allowed file types based on original MIME type
 * Returns an array of file extensions for the file input
 */
function getAllowedFileTypes(mimeType: string): string[] {
  // Map common MIME types to extensions
  const mimeToExtensions: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'application/msword': ['doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
    'application/vnd.ms-excel': ['xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
    'application/vnd.ms-powerpoint': ['ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/gif': ['gif'],
    'image/svg+xml': ['svg'],
    'image/webp': ['webp'],
    'video/mp4': ['mp4'],
    'video/quicktime': ['mov'],
    'audio/mpeg': ['mp3'],
    'audio/wav': ['wav'],
    'application/zip': ['zip'],
    'application/x-rar-compressed': ['rar'],
    'text/plain': ['txt'],
    'text/csv': ['csv'],
    'application/json': ['json'],
    'text/html': ['html', 'htm'],
    'text/css': ['css'],
    'application/javascript': ['js'],
  };

  // Return specific extensions if known, otherwise allow all
  return mimeToExtensions[mimeType] || [];
}

/**
 * Build check-in error modal
 */
export function buildCheckinErrorModal(
  file: CheckinFileInfo,
  errorMessage: string
): object {
  return {
    type: 'modal',
    callback_id: 'checkin_error_close',
    title: {
      type: 'plain_text',
      text: 'Check In Failed',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Close',
      emoji: true,
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':x: *Unable to check in file*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `File: *${file.name}*\n\nError: ${errorMessage}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Please try again. If the problem persists, contact support.',
          },
        ],
      },
    ],
  };
}
