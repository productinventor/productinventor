/**
 * Carbon Tracking Service
 *
 * Manages carbon emission records, calculations, and analytics.
 * Implements GHG Protocol standards for Scope 1, 2, and 3 emissions.
 */

import { PrismaClient, EmissionScope, EmissionCategory, DataQuality } from '@prisma/client';

export interface EmissionInput {
  facilityId?: string;
  scope: EmissionScope;
  category: EmissionCategory;
  activityData: number;
  activityUnit: string;
  emissionFactor?: number;
  emissionFactorSource?: string;
  dataQuality: DataQuality;
  source?: string;
  referenceNumber?: string;
  startDate: Date;
  endDate: Date;
  description?: string;
  notes?: string;
}

export interface EmissionSummary {
  totalEmissions: number;
  byScope: Record<string, number>;
  byCategory: Record<string, number>;
  byFacility: Record<string, number>;
  dataQualityScore: number;
  recordCount: number;
}

export interface TrendData {
  period: string;
  emissions: number;
  scope1: number;
  scope2: number;
  scope3: number;
}

/**
 * Default emission factors (kg CO2e per unit)
 * Based on common industry standards
 */
const DEFAULT_EMISSION_FACTORS: Record<string, number> = {
  // Electricity (kg CO2e/kWh) - varies by grid
  electricity_grid_average: 0.475,
  
  // Natural gas (kg CO2e/m³)
  natural_gas: 1.879,
  
  // Fuel oil (kg CO2e/L)
  fuel_oil: 2.68,
  
  // Gasoline (kg CO2e/L)
  gasoline: 2.31,
  
  // Diesel (kg CO2e/L)
  diesel: 2.68,
  
  // Air travel (kg CO2e/km)
  air_travel_short: 0.255,
  air_travel_long: 0.195,
  
  // Ground transportation (kg CO2e/km)
  car_gasoline: 0.192,
  car_diesel: 0.171,
  bus: 0.089,
  train: 0.041,
};

/**
 * Carbon Tracking Service
 */
export class CarbonTrackingService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new emission record
   */
  async createEmissionRecord(
    organizationId: string,
    userId: string,
    input: EmissionInput
  ): Promise<any> {
    // Calculate emission factor if not provided
    let emissionFactor = input.emissionFactor;
    let emissionFactorSource = input.emissionFactorSource;

    if (!emissionFactor) {
      const result = this.getDefaultEmissionFactor(input.category, input.activityUnit);
      emissionFactor = result.factor;
      emissionFactorSource = result.source;
    }

    // Calculate total emissions
    const totalEmissions = input.activityData * emissionFactor;

    // Create the record
    const record = await this.prisma.emissionRecord.create({
      data: {
        organizationId,
        userId,
        facilityId: input.facilityId,
        scope: input.scope,
        category: input.category,
        activityData: input.activityData,
        activityUnit: input.activityUnit,
        emissionFactor,
        emissionFactorSource,
        totalEmissions,
        dataQuality: input.dataQuality,
        source: input.source,
        referenceNumber: input.referenceNumber,
        startDate: input.startDate,
        endDate: input.endDate,
        description: input.description,
        notes: input.notes,
      },
      include: {
        facility: true,
        user: true,
      },
    });

    return record;
  }

  /**
   * Get emission summary for an organization
   */
  async getEmissionSummary(
    organizationId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<EmissionSummary> {
    const where: any = { organizationId };

    if (startDate || endDate) {
      where.AND = [];
      if (startDate) {
        where.AND.push({ endDate: { gte: startDate } });
      }
      if (endDate) {
        where.AND.push({ startDate: { lte: endDate } });
      }
    }

    const records = await this.prisma.emissionRecord.findMany({
      where,
      include: { facility: true },
    });

    const totalEmissions = records.reduce((sum, r) => sum + Number(r.totalEmissions), 0);

    const byScope = records.reduce((acc, r) => {
      acc[r.scope] = (acc[r.scope] || 0) + Number(r.totalEmissions);
      return acc;
    }, {} as Record<string, number>);

    const byCategory = records.reduce((acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + Number(r.totalEmissions);
      return acc;
    }, {} as Record<string, number>);

    const byFacility = records.reduce((acc, r) => {
      if (r.facilityId) {
        const facilityName = r.facility?.name || r.facilityId;
        acc[facilityName] = (acc[facilityName] || 0) + Number(r.totalEmissions);
      }
      return acc;
    }, {} as Record<string, number>);

    // Calculate data quality score (0-100)
    const qualityWeights = {
      MEASURED: 1.0,
      CALCULATED: 0.8,
      ESTIMATED: 0.5,
      PROXY: 0.3,
    };

    const totalWeight = records.reduce((sum, r) => {
      const weight = qualityWeights[r.dataQuality] || 0;
      return sum + weight * Number(r.totalEmissions);
    }, 0);

    const dataQualityScore = totalEmissions > 0 ? (totalWeight / totalEmissions) * 100 : 0;

    return {
      totalEmissions,
      byScope,
      byCategory,
      byFacility,
      dataQualityScore,
      recordCount: records.length,
    };
  }

  /**
   * Get emission trends over time
   */
  async getEmissionTrends(
    organizationId: string,
    startDate: Date,
    endDate: Date,
    groupBy: 'month' | 'quarter' | 'year' = 'month'
  ): Promise<TrendData[]> {
    const records = await this.prisma.emissionRecord.findMany({
      where: {
        organizationId,
        startDate: { gte: startDate },
        endDate: { lte: endDate },
      },
      orderBy: { startDate: 'asc' },
    });

    // Group records by period
    const grouped = new Map<string, any[]>();

    records.forEach((record) => {
      const period = this.getPeriodKey(record.startDate, groupBy);
      if (!grouped.has(period)) {
        grouped.set(period, []);
      }
      grouped.get(period)!.push(record);
    });

    // Calculate totals for each period
    const trends: TrendData[] = [];

    grouped.forEach((records, period) => {
      const emissions = records.reduce((sum, r) => sum + Number(r.totalEmissions), 0);
      const scope1 = records
        .filter((r) => r.scope === 'SCOPE_1')
        .reduce((sum, r) => sum + Number(r.totalEmissions), 0);
      const scope2 = records
        .filter((r) => r.scope === 'SCOPE_2')
        .reduce((sum, r) => sum + Number(r.totalEmissions), 0);
      const scope3 = records
        .filter((r) => r.scope === 'SCOPE_3')
        .reduce((sum, r) => sum + Number(r.totalEmissions), 0);

      trends.push({
        period,
        emissions,
        scope1,
        scope2,
        scope3,
      });
    });

    return trends.sort((a, b) => a.period.localeCompare(b.period));
  }

  /**
   * Calculate emissions intensity (emissions per revenue)
   */
  async calculateIntensity(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number | null> {
    const summary = await this.getEmissionSummary(organizationId, startDate, endDate);
    
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org?.annualRevenue || Number(org.annualRevenue) <= 0) {
      return null;
    }

    // Calculate kg CO2e per $ of revenue
    return summary.totalEmissions / Number(org.annualRevenue);
  }

  /**
   * Get top emission sources
   */
  async getTopEmissionSources(
    organizationId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 10
  ): Promise<{ category: string; emissions: number; percentage: number }[]> {
    const summary = await this.getEmissionSummary(organizationId, startDate, endDate);

    const sources = Object.entries(summary.byCategory)
      .map(([category, emissions]) => ({
        category,
        emissions,
        percentage: summary.totalEmissions > 0 ? (emissions / summary.totalEmissions) * 100 : 0,
      }))
      .sort((a, b) => b.emissions - a.emissions)
      .slice(0, limit);

    return sources;
  }

  /**
   * Update emission record
   */
  async updateEmissionRecord(
    recordId: string,
    organizationId: string,
    updates: Partial<EmissionInput>
  ): Promise<any> {
    // Verify ownership
    const existing = await this.prisma.emissionRecord.findFirst({
      where: { id: recordId, organizationId },
    });

    if (!existing) {
      throw new Error('Emission record not found');
    }

    // Recalculate total if activity data or emission factor changed
    let totalEmissions = Number(existing.totalEmissions);
    if (updates.activityData !== undefined || updates.emissionFactor !== undefined) {
      const activityData = Number(updates.activityData ?? existing.activityData);
      const emissionFactor = Number(updates.emissionFactor ?? existing.emissionFactor);
      totalEmissions = activityData * emissionFactor;
    }

    return this.prisma.emissionRecord.update({
      where: { id: recordId },
      data: {
        ...updates,
        totalEmissions,
      },
    });
  }

  /**
   * Delete emission record
   */
  async deleteEmissionRecord(recordId: string, organizationId: string): Promise<void> {
    const existing = await this.prisma.emissionRecord.findFirst({
      where: { id: recordId, organizationId },
    });

    if (!existing) {
      throw new Error('Emission record not found');
    }

    await this.prisma.emissionRecord.delete({
      where: { id: recordId },
    });
  }

  /**
   * Get default emission factor for a category
   */
  private getDefaultEmissionFactor(
    category: EmissionCategory,
    unit: string
  ): { factor: number; source: string } {
    // Map category to emission factor
    let factorKey = 'electricity_grid_average';
    
    if (category === 'PURCHASED_ELECTRICITY') {
      factorKey = 'electricity_grid_average';
    } else if (category === 'STATIONARY_COMBUSTION') {
      if (unit.toLowerCase().includes('gas') || unit.toLowerCase() === 'm³') {
        factorKey = 'natural_gas';
      }
    } else if (category === 'MOBILE_COMBUSTION') {
      if (unit.toLowerCase().includes('gasoline')) {
        factorKey = 'gasoline';
      } else if (unit.toLowerCase().includes('diesel')) {
        factorKey = 'diesel';
      }
    } else if (category === 'BUSINESS_TRAVEL') {
      factorKey = 'air_travel_long';
    } else if (category === 'EMPLOYEE_COMMUTING') {
      factorKey = 'car_gasoline';
    }

    const factor = DEFAULT_EMISSION_FACTORS[factorKey] || 0.475;

    return {
      factor,
      source: `Default emission factor (${factorKey})`,
    };
  }

  /**
   * Get period key for grouping
   */
  private getPeriodKey(date: Date, groupBy: 'month' | 'quarter' | 'year'): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    if (groupBy === 'year') {
      return `${year}`;
    } else if (groupBy === 'quarter') {
      const quarter = Math.ceil(month / 3);
      return `${year}-Q${quarter}`;
    } else {
      return `${year}-${month.toString().padStart(2, '0')}`;
    }
  }
}
