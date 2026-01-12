/**
 * User Service for EcoMetrics
 * Simplified user management for sustainability platform
 */

import { PrismaClient, UserRole } from '@prisma/client';

export interface CreateUserInput {
  email: string;
  name: string;
  organizationId: string;
  role?: UserRole;
  passwordHash?: string;
}

/**
 * User Service for user management
 */
export class UserService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new user
   */
  async createUser(input: CreateUserInput): Promise<any> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        organizationId: input.organizationId,
        role: input.role ?? 'VIEWER',
        passwordHash: input.passwordHash ?? null,
      },
    });
  }

  /**
   * Get a user by ID
   */
  async getUserById(id: string): Promise<any | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: { organization: true },
    });
  }

  /**
   * Get a user by email
   */
  async getUserByEmail(email: string): Promise<any | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: { organization: true },
    });
  }

  /**
   * Get all users in an organization
   */
  async getOrganizationUsers(organizationId: string): Promise<any[]> {
    return this.prisma.user.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: string, role: UserRole): Promise<any> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
    });
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLogin: new Date() },
    });
  }

  /**
   * Delete a user
   */
  async deleteUser(userId: string): Promise<void> {
    await this.prisma.user.delete({
      where: { id: userId },
    });
  }
}
