/**
 * Audit Service for EcoMetrics
 * Simplified version for sustainability platform audit logging
 */

import { PrismaClient, AuditEventType } from '@prisma/client';

export interface AuditEvent {
  organizationId: string;
  userId?: string;
  eventType: AuditEventType;
  resourceType?: string;
  resourceId?: string;
  action: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

/**
 * Audit Service for comprehensive audit logging
 */
export class AuditService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Log an audit event
   */
  async logEvent(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: event.organizationId,
          userId: event.userId ?? null,
          eventType: event.eventType,
          resourceType: event.resourceType ?? null,
          resourceId: event.resourceId ?? null,
          action: event.action,
          ipAddress: event.ipAddress ?? null,
          userAgent: event.userAgent ?? null,
          metadata: event.metadata ?? {},
        },
      });
    } catch (error) {
      console.error('Failed to log audit event:', error);
      // Don't throw - we don't want audit logging failures to break the application
    }
  }

  /**
   * Get audit logs for an organization
   */
  async getOrganizationLogs(
    organizationId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<any[]> {
    return this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * Get audit logs for a specific resource
   */
  async getResourceLogs(
    organizationId: string,
    resourceType: string,
    resourceId: string
  ): Promise<any[]> {
    return this.prisma.auditLog.findMany({
      where: {
        organizationId,
        resourceType,
        resourceId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }
}
