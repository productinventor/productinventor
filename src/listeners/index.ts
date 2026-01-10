/**
 * Listeners Index - Register all Slack event handlers
 *
 * Exports a single function to register all commands, actions,
 * and view handlers with the Bolt app.
 */

import type { App } from '@slack/bolt';
import type { PrismaClient } from '@prisma/client';
import type { WebClient } from '@slack/web-api';

// Services
import type { FileService } from '../services/file.service.js';
import type { ProjectService } from '../services/project.service.js';
import type { UserService } from '../services/user.service.js';
import type { AccessService } from '../services/access.service.js';
import type { LockService } from '../services/lock.service.js';
import type { HubService } from '../services/hub.service.js';
import type { ReferenceService } from '../services/reference.service.js';
import type { DownloadService } from '../services/download.service.js';

// Command handlers
import { registerFilesCommand } from './commands/files.js';
import { registerShareCommand } from './commands/share.js';

// Action handlers
import { registerCheckoutAction } from './actions/checkout.js';
import { registerCheckinActions } from './actions/checkin.js';
import { registerDownloadActions } from './actions/download.js';

// View handlers
import { registerCheckinModalHandler } from './views/checkin-modal.js';
import { registerUploadModalHandler } from './views/upload-modal.js';

/**
 * Configuration options for listeners
 */
export interface ListenerConfig {
  /**
   * Base URL for generating download links
   */
  downloadBaseUrl: string;

  /**
   * Temporary directory for file operations
   */
  tempDir: string;
}

/**
 * All service dependencies required by listeners
 */
export interface ListenerDependencies {
  // Core services
  fileService: FileService;
  projectService: ProjectService;
  userService: UserService;
  accessService: AccessService;
  lockService: LockService;
  hubService: HubService;
  referenceService: ReferenceService;
  downloadService: DownloadService;
}

/**
 * Register all Slack event listeners with the Bolt app.
 *
 * This function registers:
 * - Slash commands (/files, /share)
 * - Block actions (checkout, checkin, download buttons)
 * - View submissions (modals for upload, checkin)
 *
 * @param app - The Bolt app instance
 * @param deps - Service dependencies
 * @param config - Configuration options
 */
export function registerListeners(
  app: App,
  deps: ListenerDependencies,
  config: ListenerConfig
): void {
  // Register slash commands
  registerFilesCommand(app, {
    projectService: deps.projectService,
    fileService: deps.fileService,
    userService: deps.userService,
    accessService: deps.accessService,
  });

  registerShareCommand(app, {
    fileService: deps.fileService,
    referenceService: deps.referenceService,
    accessService: deps.accessService,
    projectService: deps.projectService,
    userService: deps.userService,
  });

  // Register action handlers
  registerCheckoutAction(app, {
    fileService: deps.fileService,
    userService: deps.userService,
    accessService: deps.accessService,
    projectService: deps.projectService,
    downloadService: deps.downloadService,
    downloadBaseUrl: config.downloadBaseUrl,
  });

  registerCheckinActions(app, {
    fileService: deps.fileService,
    userService: deps.userService,
    lockService: deps.lockService,
    hubService: deps.hubService,
    referenceService: deps.referenceService,
  });

  registerDownloadActions(app, {
    fileService: deps.fileService,
    userService: deps.userService,
    accessService: deps.accessService,
    projectService: deps.projectService,
    downloadService: deps.downloadService,
    downloadBaseUrl: config.downloadBaseUrl,
  });

  // Register view submission handlers
  registerCheckinModalHandler(app, {
    fileService: deps.fileService,
    userService: deps.userService,
    hubService: deps.hubService,
    referenceService: deps.referenceService,
    tempDir: config.tempDir,
  });

  registerUploadModalHandler(app, {
    fileService: deps.fileService,
    userService: deps.userService,
    projectService: deps.projectService,
    hubService: deps.hubService,
    tempDir: config.tempDir,
  });

  console.log('Registered all Slack listeners');
}

// Re-export individual handlers for granular registration if needed
export { registerFilesCommand } from './commands/files.js';
export { registerShareCommand } from './commands/share.js';
export { registerCheckoutAction } from './actions/checkout.js';
export { registerCheckinActions } from './actions/checkin.js';
export { registerDownloadActions } from './actions/download.js';
export { registerCheckinModalHandler } from './views/checkin-modal.js';
export { registerUploadModalHandler } from './views/upload-modal.js';

// Re-export dependency interfaces
export type { FilesCommandDependencies } from './commands/files.js';
export type { ShareCommandDependencies } from './commands/share.js';
export type { CheckoutActionDependencies } from './actions/checkout.js';
export type { CheckinActionDependencies } from './actions/checkin.js';
export type { DownloadActionDependencies } from './actions/download.js';
export type { CheckinModalDependencies } from './views/checkin-modal.js';
export type { UploadModalDependencies } from './views/upload-modal.js';
