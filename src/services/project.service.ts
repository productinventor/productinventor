/**
 * Project Service - Project/hub management
 *
 * Handles creation and retrieval of projects (file hubs).
 * Each project is associated with a Slack channel that serves as its hub.
 */

import type { PrismaClient, Project } from '@prisma/client';
import type { WebClient } from '@slack/web-api';
import type { CreateProjectData, ProjectWithFileCount } from '../types';
import { ProjectNotFoundError, ProjectAlreadyExistsError } from '../utils/errors';

/**
 * ProjectService handles project/hub management operations
 */
export class ProjectService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly slack?: WebClient
  ) {}

  /**
   * Create a new project hub.
   *
   * @param data - Project creation data
   * @returns The created project
   * @throws ProjectAlreadyExistsError if the channel is already a hub
   */
  async create(data: CreateProjectData): Promise<Project> {
    // Check if channel is already a hub
    const existing = await this.prisma.project.findUnique({
      where: { hubChannelId: data.hubChannelId },
    });

    if (existing) {
      throw new ProjectAlreadyExistsError(data.hubChannelId, existing.id);
    }

    return this.prisma.project.create({
      data: {
        name: data.name,
        slackTeamId: data.slackTeamId,
        hubChannelId: data.hubChannelId,
        createdById: data.createdById,
      },
    });
  }

  /**
   * Find a project by its hub channel ID.
   *
   * @param channelId - The Slack channel ID
   * @returns The project or null if not found
   */
  async findByChannel(channelId: string): Promise<Project | null> {
    return this.prisma.project.findUnique({
      where: { hubChannelId: channelId },
    });
  }

  /**
   * Find a project by its ID.
   *
   * @param id - The project ID
   * @returns The project or null if not found
   */
  async findById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({
      where: { id },
    });
  }

  /**
   * Find a project by its ID, throwing an error if not found.
   *
   * @param id - The project ID
   * @returns The project
   * @throws ProjectNotFoundError if not found
   */
  async findByIdOrThrow(id: string): Promise<Project> {
    const project = await this.findById(id);
    if (!project) {
      throw new ProjectNotFoundError('Project not found', id);
    }
    return project;
  }

  /**
   * Find a project by name within a team.
   *
   * @param name - The project name
   * @param slackTeamId - The Slack team ID (optional for single-team deployments)
   * @returns The project or null if not found
   */
  async findByName(name: string, slackTeamId?: string): Promise<Project | null> {
    const where: { name: { equals: string; mode: 'insensitive' }; slackTeamId?: string } = {
      name: { equals: name, mode: 'insensitive' },
    };

    if (slackTeamId) {
      where.slackTeamId = slackTeamId;
    }

    return this.prisma.project.findFirst({ where });
  }

  /**
   * Find all projects that a user can access based on Slack channel membership.
   * Queries the Slack API to determine which project hub channels the user is a member of.
   *
   * @param slackUserId - The Slack user ID
   * @returns Array of accessible projects with file counts
   */
  async findAccessibleByUser(slackUserId: string): Promise<ProjectWithFileCount[]> {
    if (!this.slack) {
      // If no Slack client, return all projects (for testing)
      return this.prisma.project.findMany({
        include: {
          _count: {
            select: { files: true },
          },
        },
      });
    }

    // Get all projects
    const allProjects = await this.prisma.project.findMany({
      include: {
        _count: {
          select: { files: true },
        },
      },
    });

    // Filter to projects where user is a member of the hub channel
    const accessibleProjects: ProjectWithFileCount[] = [];

    for (const project of allProjects) {
      try {
        // Check if user is a member of the hub channel
        const result = await this.slack.conversations.members({
          channel: project.hubChannelId,
          limit: 1000,
        });

        if (result.members?.includes(slackUserId)) {
          accessibleProjects.push(project);
        }
      } catch (error) {
        // Channel not found, bot not in channel, or user not found
        // Skip this project
        continue;
      }
    }

    return accessibleProjects;
  }

  /**
   * List all projects in a Slack team.
   *
   * @param slackTeamId - The Slack team ID
   * @returns Array of projects with file counts
   */
  async listByTeam(slackTeamId: string): Promise<ProjectWithFileCount[]> {
    return this.prisma.project.findMany({
      where: { slackTeamId },
      include: {
        _count: {
          select: { files: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Update a project's name.
   *
   * @param id - The project ID
   * @param name - The new name
   * @returns The updated project
   * @throws ProjectNotFoundError if not found
   */
  async updateName(id: string, name: string): Promise<Project> {
    const project = await this.findById(id);
    if (!project) {
      throw new ProjectNotFoundError('Project not found', id);
    }

    return this.prisma.project.update({
      where: { id },
      data: { name },
    });
  }

  /**
   * Delete a project and all its files.
   * This is a destructive operation and should be used with caution.
   *
   * @param id - The project ID
   * @throws ProjectNotFoundError if not found
   */
  async delete(id: string): Promise<void> {
    const project = await this.findById(id);
    if (!project) {
      throw new ProjectNotFoundError('Project not found', id);
    }

    // Delete in transaction (cascade will handle related records)
    await this.prisma.$transaction(async (tx) => {
      // Get all file IDs
      const files = await tx.file.findMany({
        where: { projectId: id },
        select: { id: true },
      });

      // Delete file references
      await tx.fileReference.deleteMany({
        where: { projectId: id },
      });

      // Delete file versions
      for (const file of files) {
        await tx.fileVersion.deleteMany({ where: { fileId: file.id } });
        await tx.fileLock.deleteMany({ where: { fileId: file.id } });
      }

      // Delete files
      await tx.file.deleteMany({ where: { projectId: id } });

      // Delete project
      await tx.project.delete({ where: { id } });
    });
  }

  /**
   * Get project with detailed statistics.
   *
   * @param id - The project ID
   * @returns Project with statistics or null
   */
  async findWithStats(id: string): Promise<{
    project: Project;
    stats: {
      fileCount: number;
      totalVersions: number;
      totalSize: bigint;
      lockedFileCount: number;
    };
  } | null> {
    const project = await this.findById(id);
    if (!project) {
      return null;
    }

    // Get file statistics
    const [fileStats, lockCount] = await Promise.all([
      this.prisma.file.aggregate({
        where: { projectId: id },
        _count: { id: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.fileLock.count({
        where: {
          file: { projectId: id },
        },
      }),
    ]);

    // Get total version count
    const versionCount = await this.prisma.fileVersion.count({
      where: {
        file: { projectId: id },
      },
    });

    return {
      project,
      stats: {
        fileCount: fileStats._count.id,
        totalVersions: versionCount,
        totalSize: fileStats._sum.sizeBytes ?? BigInt(0),
        lockedFileCount: lockCount,
      },
    };
  }

  /**
   * Check if a user created a project.
   *
   * @param projectId - The project ID
   * @param userId - The user ID
   * @returns True if the user created the project
   */
  async isCreator(projectId: string, userId: string): Promise<boolean> {
    const project = await this.findById(projectId);
    return project?.createdById === userId;
  }

  /**
   * Get the hub channel ID for a project.
   *
   * @param projectId - The project ID
   * @returns The hub channel ID or null
   */
  async getHubChannelId(projectId: string): Promise<string | null> {
    const project = await this.findById(projectId);
    return project?.hubChannelId ?? null;
  }

  /**
   * Get all project IDs that have a file with the given content hash.
   * Useful for determining if content can be deleted.
   *
   * @param contentHash - The content hash to search for
   * @returns Array of project IDs
   */
  async findProjectsByContentHash(contentHash: string): Promise<string[]> {
    const versions = await this.prisma.fileVersion.findMany({
      where: { contentHash },
      select: {
        file: {
          select: { projectId: true },
        },
      },
      distinct: ['fileId'],
    });

    const projectIds = new Set(versions.map((v) => v.file.projectId));
    return Array.from(projectIds);
  }
}
