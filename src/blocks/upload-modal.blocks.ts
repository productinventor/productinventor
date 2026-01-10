/**
 * Upload new file modal block builder
 * Builds the modal for uploading a new file to a project
 */

/**
 * Project info for upload modal
 */
export interface UploadProjectInfo {
  id: string;
  name: string;
  hubChannelId: string;
}

/**
 * Existing directory paths for suggestions
 */
export type DirectoryPaths = string[];

/**
 * Build upload new file modal
 */
export function buildUploadModal(
  project: UploadProjectInfo,
  existingPaths?: DirectoryPaths
): object {
  const pathOptions = buildPathOptions(existingPaths);

  return {
    type: 'modal',
    callback_id: 'upload_modal_submit',
    private_metadata: JSON.stringify({
      projectId: project.id,
      hubChannelId: project.hubChannelId,
    }),
    title: {
      type: 'plain_text',
      text: 'Upload File',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Upload',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      // Project info
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:file_cabinet: Uploading to *${project.name}*`,
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
        },
        label: {
          type: 'plain_text',
          text: 'Select File',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Choose a file to upload to this project.',
        },
      },
      // File path input with directory selector
      ...(pathOptions.length > 0
        ? [
            {
              type: 'input',
              block_id: 'directory_select_block',
              optional: true,
              element: {
                type: 'static_select',
                action_id: 'directory_select_input',
                placeholder: {
                  type: 'plain_text',
                  text: 'Select existing directory...',
                },
                options: pathOptions,
              },
              label: {
                type: 'plain_text',
                text: 'Directory',
                emoji: true,
              },
              hint: {
                type: 'plain_text',
                text: 'Select an existing directory or enter a custom path below.',
              },
            },
          ]
        : []),
      // Custom path input
      {
        type: 'input',
        block_id: 'custom_path_block',
        optional: pathOptions.length > 0,
        element: {
          type: 'plain_text_input',
          action_id: 'custom_path_input',
          max_length: 255,
          placeholder: {
            type: 'plain_text',
            text: '/path/to/file (e.g., /designs/mockups)',
          },
        },
        label: {
          type: 'plain_text',
          text: pathOptions.length > 0 ? 'Or Enter Custom Path' : 'File Path',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'The path where this file will be stored. Use forward slashes (/).',
        },
      },
      // Description input (optional)
      {
        type: 'input',
        block_id: 'description_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'description_input',
          multiline: true,
          max_length: 500,
          placeholder: {
            type: 'plain_text',
            text: 'Describe this file...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Description',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Optional: Add a description for this file.',
        },
      },
      // Info section
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':information_source: The file will be created as v1 and a card will be posted in the project hub channel.',
          },
        ],
      },
    ],
  };
}

/**
 * Build directory path options for select menu
 */
function buildPathOptions(paths?: DirectoryPaths): object[] {
  if (!paths || paths.length === 0) {
    return [];
  }

  // Always include root
  const options: object[] = [
    {
      text: { type: 'plain_text', text: '/ (root)' },
      value: '/',
    },
  ];

  // Add unique directories sorted
  const uniquePaths = Array.from(new Set(paths)).sort();
  for (const path of uniquePaths) {
    if (path !== '/') {
      options.push({
        text: { type: 'plain_text', text: path },
        value: path,
      });
    }
  }

  return options;
}

/**
 * Build upload success modal
 */
export function buildUploadSuccessModal(
  fileName: string,
  filePath: string,
  projectName: string
): object {
  return {
    type: 'modal',
    callback_id: 'upload_success_close',
    title: {
      type: 'plain_text',
      text: 'Upload Complete',
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
          text: ':white_check_mark: *File uploaded successfully!*',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*File:*\n${fileName}`,
          },
          {
            type: 'mrkdwn',
            text: `*Path:*\n\`${filePath}\``,
          },
        ],
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
            text: '*Version:*\nv1',
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
          text: 'A file card has been posted to the project hub channel. You can now share this file with other channels.',
        },
      },
    ],
  };
}

/**
 * Build upload error modal
 */
export function buildUploadErrorModal(
  errorMessage: string,
  projectName: string
): object {
  return {
    type: 'modal',
    callback_id: 'upload_error_close',
    title: {
      type: 'plain_text',
      text: 'Upload Failed',
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
          text: ':x: *Unable to upload file*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Project: *${projectName}*\n\nError: ${errorMessage}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':bulb: Common issues:\n- File size exceeds limit\n- File type not allowed\n- Path already exists',
          },
        ],
      },
    ],
  };
}

/**
 * Build duplicate file warning modal
 */
export function buildDuplicateFileModal(
  fileName: string,
  existingPath: string,
  projectName: string
): object {
  return {
    type: 'modal',
    callback_id: 'duplicate_file_warning',
    title: {
      type: 'plain_text',
      text: 'File Exists',
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
          text: ':warning: *A file with this name already exists*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${fileName}* already exists at \`${existingPath}\` in *${projectName}*.`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Would you like to:',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: ':arrows_counterclockwise: Update Existing', emoji: true },
            style: 'primary',
            action_id: 'update_existing_file',
            value: existingPath,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: ':heavy_plus_sign: Create New', emoji: true },
            action_id: 'create_with_new_name',
          },
        ],
      },
    ],
  };
}

/**
 * Build bulk upload modal for multiple files
 */
export function buildBulkUploadModal(
  project: UploadProjectInfo,
  existingPaths?: DirectoryPaths
): object {
  const pathOptions = buildPathOptions(existingPaths);

  return {
    type: 'modal',
    callback_id: 'bulk_upload_modal_submit',
    private_metadata: JSON.stringify({
      projectId: project.id,
      hubChannelId: project.hubChannelId,
    }),
    title: {
      type: 'plain_text',
      text: 'Upload Files',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Upload All',
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
          text: `:file_cabinet: Bulk upload to *${project.name}*`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'input',
        block_id: 'files_upload_block',
        element: {
          type: 'file_input',
          action_id: 'files_upload_input',
          max_files: 10,
        },
        label: {
          type: 'plain_text',
          text: 'Select Files',
          emoji: true,
        },
        hint: {
          type: 'plain_text',
          text: 'Select up to 10 files to upload at once.',
        },
      },
      ...(pathOptions.length > 0
        ? [
            {
              type: 'input',
              block_id: 'bulk_directory_block',
              optional: true,
              element: {
                type: 'static_select',
                action_id: 'bulk_directory_input',
                placeholder: {
                  type: 'plain_text',
                  text: 'Select directory for all files...',
                },
                options: pathOptions,
              },
              label: {
                type: 'plain_text',
                text: 'Upload Directory',
                emoji: true,
              },
            },
          ]
        : []),
      {
        type: 'input',
        block_id: 'bulk_custom_path_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'bulk_custom_path_input',
          max_length: 255,
          placeholder: {
            type: 'plain_text',
            text: '/path/for/all/files',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Or Custom Path',
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':information_source: All files will be uploaded to the same directory. Individual file cards will be created in the hub channel.',
          },
        ],
      },
    ],
  };
}
