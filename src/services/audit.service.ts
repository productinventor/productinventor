import { PrismaClient, AuditLog, AuditEventType, AuditOutcome } from '@prisma/client';

/**
 * Request metadata for audit logging
 */
export interface RequestMetadata {
  ip: string;
  userAgent: string;
}

/**
 * Audit log event input
 */
export interface AuditEvent {
  eventType: AuditEventType;
  outcome: AuditOutcome;
  userId?: string;
  slackUserId?: string;
  projectId?: string;
  fileId?: string;
  fileVersionId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

/**
 * Options for querying file access history
 */
export interface FileAccessHistoryOptions {
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * Date range for compliance reports
 */
export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Compliance report structure
 */
export interface ComplianceReport {
  projectId: string;
  dateRange: DateRange;
  generatedAt: Date;
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByOutcome: Record<string, number>;
  accessDenials: AuditLog[];
  uniqueUsers: string[];
  downloadCount: number;
  checkoutCount: number;
  checkinCount: number;
  securityEvents: AuditLog[];
  timeline: Array<{
    date: string;
    eventCount: number;
  }>;
}

/**
 * Comprehensive audit logging service for compliance and security.
 *
 * All file operations are logged to an append-only audit log for:
 * - Compliance with NDA requirements
 * - Security forensics and incident investigation
 * - Access pattern analysis
 * - Generating compliance reports
 */
export class AuditService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create an audit log entry.
   *
   * @param event - The audit event to log
   * @returns The created audit log entry
   */
  async log(event: AuditEvent): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        eventType: event.eventType,
        outcome: event.outcome,
        userId: event.userId,
        slackUserId: event.slackUserId,
        projectId: event.projectId,
        fileId: event.fileId,
        fileVersionId: event.fileVersionId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        details: event.details ?? {},
      },
    });
  }

  /**
   * Log a file download event.
   *
   * @param userId - The user who downloaded the file
   * @param fileId - The file that was downloaded
   * @param versionNumber - The version number that was downloaded
   * @param request - Request metadata (IP, user agent)
   */
  async logFileDownload(
    userId: string,
    fileId: string,
    versionNumber: number,
    request: RequestMetadata
  ): Promise<AuditLog> {
    return this.log({
      eventType: 'FILE_DOWNLOAD',
      outcome: 'SUCCESS',
      userId,
      fileId,
      ipAddress: request.ip,
      userAgent: request.userAgent,
      details: { versionNumber },
    });
  }

  /**
   * Log an access denial event.
   *
   * @param userId - The user who was denied access
   * @param projectId - The project they tried to access
   * @param reason - The reason for denial
   * @param request - Optional request metadata
   */
  async logAccessDenied(
    userId: string,
    projectId: string,
    reason: string,
    request?: RequestMetadata
  ): Promise<AuditLog> {
    return this.log({
      eventType: 'ACCESS_DENIED',
      outcome: 'DENIED',
      userId,
      projectId,
      ipAddress: request?.ip,
      userAgent: request?.userAgent,
      details: { reason },
    });
  }

  /**
   * Log a file checkout event.
   *
   * @param userId - The user who checked out the file
   * @param fileId - The file that was checked out
   * @param projectId - The project containing the file
   * @param request - Optional request metadata
   */
  async logFileCheckout(
    userId: string,
    fileId: string,
    projectId: string,
    request?: RequestMetadata
  ): Promise<AuditLog> {
    return this.log({
      eventType: 'FILE_CHECKOUT',
      outcome: 'SUCCESS',
      userId,
      fileId,
      projectId,
      ipAddress: request?.ip,
      userAgent: request?.userAgent,
    });
  }

  /**
   * Log a file check-in event.
   *
   * @param userId - The user who checked in the file
   * @param fileId - The file that was checked in
   * @param projectId - The project containing the file
   * @param versionNumber - The new version number
   * @param request - Optional request metadata
   */
  async logFileCheckin(
    userId: string,
    fileId: string,
    projectId: string,
    versionNumber: number,
    request?: RequestMetadata
  ): Promise<AuditLog> {
    return this.log({
      eventType: 'FILE_CHECKIN',
      outcome: 'SUCCESS',
      userId,
      fileId,
      projectId,
      ipAddress: request?.ip,
      userAgent: request?.userAgent,
      details: { versionNumber },
    });
  }

  /**
   * Log a file upload event.
   *
   * @param userId - The user who uploaded the file
   * @param fileId - The new file ID
   * @param projectId - The project containing the file
   * @param fileName - The name of the uploaded file
   * @param sizeBytes - The size of the file in bytes
   */
  async logFileUpload(
    userId: string,
    fileId: string,
    projectId: string,
    fileName: string,
    sizeBytes: bigint
  ): Promise<AuditLog> {
    return this.log({
      eventType: 'FILE_UPLOAD',
      outcome: 'SUCCESS',
      userId,
      fileId,
      projectId,
      details: { fileName, sizeBytes: sizeBytes.toString() },
    });
  }

  /**
   * Log a file deletion event.
   *
   * @param userId - The user who deleted the file
   * @param fileId - The file that was deleted
   * @param projectId - The project containing the file
   * @param fileName - The name of the deleted file
   */
  async logFileDeletion(
    userId: string,
    fileId: string,
    projectId: string,
    fileName: string
  ): Promise<AuditLog> {
    return this.log({
      eventType: 'FILE_DELETE',
      outcome: 'SUCCESS',
      userId,
      fileId,
      projectId,
      details: { fileName },
    });
  }

  /**
   * Query file access history for a specific file.
   *
   * @param fileId - The file to query access history for
   * @param options - Query options (date range, limit)
   * @returns List of audit log entries for the file
   */
  async getFileAccessHistory(
    fileId: string,
    options: FileAccessHistoryOptions = {}
  ): Promise<AuditLog[]> {
    const { from, to, limit = 1000 } = options;

    return this.prisma.auditLog.findMany({
      where: {
        fileId,
        eventType: {
          in: ['FILE_DOWNLOAD', 'FILE_VIEW', 'FILE_CHECKOUT', 'FILE_CHECKIN'],
        },
        timestamp: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Get access history for a specific user.
   *
   * @param userId - The user to query access history for
   * @param options - Query options (date range, limit)
   * @returns List of audit log entries for the user
   */
  async getUserAccessHistory(
    userId: string,
    options: FileAccessHistoryOptions = {}
  ): Promise<AuditLog[]> {
    const { from, to, limit = 1000 } = options;

    return this.prisma.auditLog.findMany({
      where: {
        userId,
        timestamp: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Generate a compliance report for a project.
   *
   * This report provides a comprehensive overview of all activity
   * for audit and NDA compliance purposes.
   *
   * @param projectId - The project to generate the report for
   * @param dateRange - The date range to include in the report
   * @returns A comprehensive compliance report
   */
  async generateComplianceReport(
    projectId: string,
    dateRange: DateRange
  ): Promise<ComplianceReport> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        projectId,
        timestamp: {
          gte: dateRange.from,
          lte: dateRange.to,
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    // Group events by type
    const eventsByType = this.groupBy(logs, 'eventType');

    // Group events by outcome
    const eventsByOutcome = this.groupBy(logs, 'outcome');

    // Get access denials
    const accessDenials = logs.filter((log) => log.outcome === 'DENIED');

    // Get unique users
    const uniqueUsers = [
      ...new Set(logs.map((log) => log.userId).filter((id): id is string => id !== null)),
    ];

    // Count specific events
    const downloadCount = logs.filter((log) => log.eventType === 'FILE_DOWNLOAD').length;
    const checkoutCount = logs.filter((log) => log.eventType === 'FILE_CHECKOUT').length;
    const checkinCount = logs.filter((log) => log.eventType === 'FILE_CHECKIN').length;

    // Get security-related events
    const securityEventTypes: AuditEventType[] = [
      'ACCESS_DENIED',
      'ACCESS_REVOKED',
      'SECURE_DELETE_STARTED',
      'SECURE_DELETE_COMPLETED',
      'ADMIN_OVERRIDE',
      'LOCK_FORCE_RELEASE',
    ];
    const securityEvents = logs.filter((log) =>
      securityEventTypes.includes(log.eventType)
    );

    // Build timeline (events per day)
    const timeline = this.buildTimeline(logs, dateRange);

    return {
      projectId,
      dateRange,
      generatedAt: new Date(),
      totalEvents: logs.length,
      eventsByType,
      eventsByOutcome,
      accessDenials,
      uniqueUsers,
      downloadCount,
      checkoutCount,
      checkinCount,
      securityEvents,
      timeline,
    };
  }

  /**
   * Get all security events for a project within a date range.
   *
   * @param projectId - The project to query
   * @param dateRange - The date range to query
   * @returns List of security-related audit log entries
   */
  async getSecurityEvents(
    projectId: string,
    dateRange: DateRange
  ): Promise<AuditLog[]> {
    const securityEventTypes: AuditEventType[] = [
      'ACCESS_DENIED',
      'ACCESS_REVOKED',
      'SECURE_DELETE_STARTED',
      'SECURE_DELETE_COMPLETED',
      'ADMIN_OVERRIDE',
      'LOCK_FORCE_RELEASE',
      'DOWNLOAD_TOKEN_EXPIRED',
    ];

    return this.prisma.auditLog.findMany({
      where: {
        projectId,
        eventType: { in: securityEventTypes },
        timestamp: {
          gte: dateRange.from,
          lte: dateRange.to,
        },
      },
      orderBy: { timestamp: 'desc' },
    });
  }

  /**
   * Count failed access attempts for a user within a time window.
   * Useful for detecting potential security issues.
   *
   * @param userId - The user to check
   * @param windowMinutes - The time window in minutes
   * @returns The count of failed access attempts
   */
  async countFailedAccessAttempts(
    userId: string,
    windowMinutes: number = 60
  ): Promise<number> {
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

    return this.prisma.auditLog.count({
      where: {
        userId,
        eventType: 'ACCESS_DENIED',
        timestamp: { gte: windowStart },
      },
    });
  }

  /**
   * Group audit logs by a specific field.
   *
   * @param logs - The logs to group
   * @param field - The field to group by
   * @returns A record of field values to counts
   */
  private groupBy(
    logs: AuditLog[],
    field: keyof AuditLog
  ): Record<string, number> {
    return logs.reduce((acc, log) => {
      const key = String(log[field] ?? 'unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Build a timeline of events per day.
   *
   * @param logs - The logs to build timeline from
   * @param dateRange - The date range for the timeline
   * @returns Array of date/count pairs
   */
  private buildTimeline(
    logs: AuditLog[],
    dateRange: DateRange
  ): Array<{ date: string; eventCount: number }> {
    const timeline: Map<string, number> = new Map();

    // Initialize all dates in range with 0
    const currentDate = new Date(dateRange.from);
    while (currentDate <= dateRange.to) {
      const dateKey = currentDate.toISOString().split('T')[0];
      timeline.set(dateKey, 0);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Count events per day
    for (const log of logs) {
      const dateKey = log.timestamp.toISOString().split('T')[0];
      timeline.set(dateKey, (timeline.get(dateKey) || 0) + 1);
    }

    // Convert to array
    return Array.from(timeline.entries())
      .map(([date, eventCount]) => ({ date, eventCount }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
