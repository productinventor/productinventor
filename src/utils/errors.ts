/**
 * Custom error classes for the Slack file checkout system
 */

/**
 * Base error class for application errors
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when a file is locked by another user
 */
export class FileLockedError extends AppError {
  public readonly lockedByUserId: string;
  public readonly lockedAt: Date;
  public readonly expiresAt: Date | null;

  constructor(
    message: string,
    lockedByUserId: string,
    lockedAt: Date,
    expiresAt: Date | null = null
  ) {
    super(message, 'FILE_LOCKED', 409);
    this.lockedByUserId = lockedByUserId;
    this.lockedAt = lockedAt;
    this.expiresAt = expiresAt;
  }
}

/**
 * Error thrown when a file is not found
 */
export class FileNotFoundError extends AppError {
  public readonly fileId?: string;
  public readonly fileName?: string;

  constructor(message: string = 'File not found', fileId?: string, fileName?: string) {
    super(message, 'FILE_NOT_FOUND', 404);
    this.fileId = fileId;
    this.fileName = fileName;
  }
}

/**
 * Error thrown when a user does not have access to a resource
 */
export class AccessDeniedError extends AppError {
  public readonly userId: string;
  public readonly resourceType: string;
  public readonly resourceId?: string;

  constructor(
    message: string,
    userId: string,
    resourceType: string = 'resource',
    resourceId?: string
  ) {
    super(message, 'ACCESS_DENIED', 403);
    this.userId = userId;
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/**
 * Error thrown when a user is not authorized to perform an action
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'You are not authorized to perform this action') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

/**
 * Error thrown when a project is not found
 */
export class ProjectNotFoundError extends AppError {
  public readonly projectId?: string;
  public readonly channelId?: string;

  constructor(
    message: string = 'Project not found',
    projectId?: string,
    channelId?: string
  ) {
    super(message, 'PROJECT_NOT_FOUND', 404);
    this.projectId = projectId;
    this.channelId = channelId;
  }
}

/**
 * Error thrown when a user is not found
 */
export class UserNotFoundError extends AppError {
  public readonly userId?: string;
  public readonly slackUserId?: string;

  constructor(
    message: string = 'User not found',
    userId?: string,
    slackUserId?: string
  ) {
    super(message, 'USER_NOT_FOUND', 404);
    this.userId = userId;
    this.slackUserId = slackUserId;
  }
}

/**
 * Error thrown when a lock is not found
 */
export class LockNotFoundError extends AppError {
  public readonly fileId: string;

  constructor(fileId: string, message: string = 'Lock not found') {
    super(message, 'LOCK_NOT_FOUND', 404);
    this.fileId = fileId;
  }
}

/**
 * Error thrown when a version is not found
 */
export class VersionNotFoundError extends AppError {
  public readonly fileId: string;
  public readonly versionNumber?: number;

  constructor(fileId: string, versionNumber?: number) {
    const message = versionNumber
      ? `Version ${versionNumber} not found for file`
      : 'Version not found';
    super(message, 'VERSION_NOT_FOUND', 404);
    this.fileId = fileId;
    this.versionNumber = versionNumber;
  }
}

/**
 * Error thrown when a project already exists for a channel
 */
export class ProjectAlreadyExistsError extends AppError {
  public readonly channelId: string;
  public readonly existingProjectId: string;

  constructor(channelId: string, existingProjectId: string) {
    super(
      'This channel is already a file hub for another project',
      'PROJECT_ALREADY_EXISTS',
      409
    );
    this.channelId = channelId;
    this.existingProjectId = existingProjectId;
  }
}

/**
 * Error thrown when storage operations fail
 */
export class StorageError extends AppError {
  public readonly operation: string;
  public readonly path?: string;

  constructor(message: string, operation: string, path?: string) {
    super(message, 'STORAGE_ERROR', 500);
    this.operation = operation;
    this.path = path;
  }
}
