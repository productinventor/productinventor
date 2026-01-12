/**
 * Sustainability Goals Service
 *
 * Manages sustainability goals, targets, and progress tracking.
 * Supports science-based targets and net-zero commitments.
 */

import { PrismaClient, GoalStatus, EmissionScope } from '@prisma/client';

export interface GoalInput {
  name: string;
  description?: string;
  scope?: EmissionScope;
  baselineYear: number;
  baselineValue: number;
  targetYear: number;
  targetValue: number;
  reductionPercent: number;
}

export interface GoalProgress {
  goalId: string;
  goalName: string;
  targetYear: number;
  reductionPercent: number;
  baselineValue: number;
  targetValue: number;
  currentValue: number;
  progressPercent: number;
  status: GoalStatus;
  yearsRemaining: number;
  onTrack: boolean;
  projectedAchievementYear?: number;
}

/**
 * Sustainability Goals Service
 */
export class SustainabilityGoalsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new sustainability goal
   */
  async createGoal(organizationId: string, input: GoalInput): Promise<any> {
    // Validate input
    if (input.targetYear <= input.baselineYear) {
      throw new Error('Target year must be after baseline year');
    }

    if (input.reductionPercent < 0 || input.reductionPercent > 100) {
      throw new Error('Reduction percentage must be between 0 and 100');
    }

    const goal = await this.prisma.sustainabilityGoal.create({
      data: {
        organizationId,
        name: input.name,
        description: input.description,
        scope: input.scope,
        baselineYear: input.baselineYear,
        baselineValue: input.baselineValue,
        targetYear: input.targetYear,
        targetValue: input.targetValue,
        reductionPercent: input.reductionPercent,
        status: 'ACTIVE',
      },
    });

    // Calculate initial progress
    await this.updateGoalProgress(goal.id);

    return goal;
  }

  /**
   * Update goal progress based on current emissions
   */
  async updateGoalProgress(goalId: string): Promise<any> {
    const goal = await this.prisma.sustainabilityGoal.findUnique({
      where: { id: goalId },
    });

    if (!goal) {
      throw new Error('Goal not found');
    }

    // Calculate current emissions for the goal's scope
    const currentYear = new Date().getFullYear();
    const startDate = new Date(currentYear, 0, 1);
    const endDate = new Date(currentYear, 11, 31);

    const where: any = {
      organizationId: goal.organizationId,
      startDate: { gte: startDate },
      endDate: { lte: endDate },
    };

    if (goal.scope) {
      where.scope = goal.scope;
    }

    const records = await this.prisma.emissionRecord.findMany({ where });

    const currentValue = records.reduce((sum, r) => sum + Number(r.totalEmissions), 0);

    // Calculate progress percentage
    const baselineValue = Number(goal.baselineValue);
    const targetValue = Number(goal.targetValue);
    const reductionAchieved = baselineValue - currentValue;
    const reductionRequired = baselineValue - targetValue;
    
    const progressPercent = reductionRequired > 0 
      ? Math.min(100, (reductionAchieved / reductionRequired) * 100)
      : 0;

    // Determine status
    let status = goal.status;
    if (currentYear >= goal.targetYear) {
      if (currentValue <= targetValue) {
        status = 'ACHIEVED';
      } else {
        status = 'MISSED';
      }
    }

    // Update the goal
    return this.prisma.sustainabilityGoal.update({
      where: { id: goalId },
      data: {
        currentValue,
        progressPercent,
        status,
      },
    });
  }

  /**
   * Get goal progress details
   */
  async getGoalProgress(goalId: string): Promise<GoalProgress> {
    const goal = await this.prisma.sustainabilityGoal.findUnique({
      where: { id: goalId },
    });

    if (!goal) {
      throw new Error('Goal not found');
    }

    const currentYear = new Date().getFullYear();
    const yearsRemaining = goal.targetYear - currentYear;
    const progressPercent = Number(goal.progressPercent ?? 0);
    
    // Calculate if on track
    const yearsElapsed = currentYear - goal.baselineYear;
    const totalYears = goal.targetYear - goal.baselineYear;
    const expectedProgress = totalYears > 0 ? (yearsElapsed / totalYears) * 100 : 0;
    const onTrack = progressPercent >= expectedProgress * 0.9; // 90% of expected progress

    // Project achievement year based on current progress rate
    let projectedAchievementYear: number | undefined;
    if (progressPercent > 0 && progressPercent < 100) {
      const yearsPerPercent = yearsElapsed / progressPercent;
      const yearsToCompletion = (100 - progressPercent) * yearsPerPercent;
      projectedAchievementYear = Math.ceil(currentYear + yearsToCompletion);
    }

    return {
      goalId: goal.id,
      goalName: goal.name,
      targetYear: goal.targetYear,
      reductionPercent: Number(goal.reductionPercent),
      baselineValue: Number(goal.baselineValue),
      targetValue: Number(goal.targetValue),
      currentValue: Number(goal.currentValue ?? 0),
      progressPercent,
      status: goal.status,
      yearsRemaining,
      onTrack,
      projectedAchievementYear,
    };
  }

  /**
   * Get all goals for an organization
   */
  async getOrganizationGoals(
    organizationId: string,
    status?: GoalStatus
  ): Promise<any[]> {
    const where: any = { organizationId };
    if (status) {
      where.status = status;
    }

    const goals = await this.prisma.sustainabilityGoal.findMany({
      where,
      orderBy: { targetYear: 'asc' },
    });

    return goals;
  }

  /**
   * Update a goal
   */
  async updateGoal(
    goalId: string,
    organizationId: string,
    updates: Partial<GoalInput>
  ): Promise<any> {
    // Verify ownership
    const existing = await this.prisma.sustainabilityGoal.findFirst({
      where: { id: goalId, organizationId },
    });

    if (!existing) {
      throw new Error('Goal not found');
    }

    // Recalculate reduction percent if baseline or target changed
    let reductionPercent = updates.reductionPercent;
    if (
      (updates.baselineValue !== undefined || updates.targetValue !== undefined) &&
      reductionPercent === undefined
    ) {
      const baselineValue = updates.baselineValue ?? Number(existing.baselineValue);
      const targetValue = updates.targetValue ?? Number(existing.targetValue);
      reductionPercent = baselineValue > 0 
        ? ((baselineValue - targetValue) / baselineValue) * 100 
        : 0;
    }

    const updated = await this.prisma.sustainabilityGoal.update({
      where: { id: goalId },
      data: {
        ...updates,
        reductionPercent,
      },
    });

    // Recalculate progress
    await this.updateGoalProgress(goalId);

    return updated;
  }

  /**
   * Delete a goal
   */
  async deleteGoal(goalId: string, organizationId: string): Promise<void> {
    const existing = await this.prisma.sustainabilityGoal.findFirst({
      where: { id: goalId, organizationId },
    });

    if (!existing) {
      throw new Error('Goal not found');
    }

    await this.prisma.sustainabilityGoal.delete({
      where: { id: goalId },
    });
  }

  /**
   * Calculate science-based target (aligned with 1.5°C pathway)
   */
  calculateScienceBasedTarget(
    baselineValue: number,
    baselineYear: number,
    targetYear: number
  ): { targetValue: number; reductionPercent: number } {
    // Science-based targets typically require 4.2% annual reduction for 1.5°C alignment
    const annualReductionRate = 0.042;
    const years = targetYear - baselineYear;
    
    // Calculate compound reduction
    const targetValue = baselineValue * Math.pow(1 - annualReductionRate, years);
    const reductionPercent = ((baselineValue - targetValue) / baselineValue) * 100;

    return {
      targetValue: Math.round(targetValue),
      reductionPercent: Math.round(reductionPercent * 100) / 100,
    };
  }

  /**
   * Assess goal risk level
   */
  async assessGoalRisk(goalId: string): Promise<'low' | 'medium' | 'high'> {
    const progress = await this.getGoalProgress(goalId);

    // High risk: behind schedule or less than 2 years remaining with <80% progress
    if (!progress.onTrack) {
      return 'high';
    }

    if (progress.yearsRemaining <= 2 && progress.progressPercent < 80) {
      return 'high';
    }

    // Medium risk: 50-90% of expected progress
    const currentYear = new Date().getFullYear();
    const goal = await this.prisma.sustainabilityGoal.findUnique({
      where: { id: goalId },
    });

    if (goal) {
      const yearsElapsed = currentYear - goal.baselineYear;
      const totalYears = goal.targetYear - goal.baselineYear;
      const expectedProgress = totalYears > 0 ? (yearsElapsed / totalYears) * 100 : 0;

      if (progress.progressPercent < expectedProgress * 0.9) {
        return 'medium';
      }
    }

    // Low risk: on track or ahead
    return 'low';
  }

  /**
   * Update all goals progress for an organization
   */
  async updateAllGoalsProgress(organizationId: string): Promise<void> {
    const goals = await this.prisma.sustainabilityGoal.findMany({
      where: { organizationId, status: 'ACTIVE' },
    });

    for (const goal of goals) {
      await this.updateGoalProgress(goal.id);
    }
  }
}
