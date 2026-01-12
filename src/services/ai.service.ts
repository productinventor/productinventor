/**
 * AI Service - Foundation for AI-powered insights
 *
 * Provides a unified interface for interacting with AI providers (OpenAI, Anthropic)
 * to power natural language queries, sustainability insights, and recommendations.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import type { AIProvider } from '../config/index.js';

export interface AIQuery {
  query: string;
  context?: Record<string, any>;
  maxTokens?: number;
  temperature?: number;
}

export interface AIResponse {
  response: string;
  confidence?: number;
  tokensUsed?: number;
  processingTimeMs: number;
  model: string;
  provider: string;
}

export interface SustainabilityInsight {
  insight: string;
  category: 'emission_reduction' | 'cost_savings' | 'risk_mitigation' | 'opportunity';
  priority: 'high' | 'medium' | 'low';
  estimatedImpact?: string;
}

/**
 * AI Service for sustainability analytics and natural language processing
 */
export class AIService {
  private openaiClient?: OpenAI;
  private anthropicClient?: Anthropic;
  private provider: AIProvider;
  private defaultModel: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(
    private prisma: PrismaClient,
    provider: AIProvider,
    openaiApiKey?: string,
    openaiModel: string = 'gpt-4-turbo-preview',
    anthropicApiKey?: string,
    anthropicModel: string = 'claude-3-sonnet-20240229',
    maxTokens: number = 4096,
    temperature: number = 0.7
  ) {
    this.provider = provider;
    this.defaultMaxTokens = maxTokens;
    this.defaultTemperature = temperature;

    if (provider === 'openai') {
      if (!openaiApiKey) {
        throw new Error('OpenAI API key is required when provider is "openai"');
      }
      this.openaiClient = new OpenAI({ apiKey: openaiApiKey });
      this.defaultModel = openaiModel;
    } else if (provider === 'anthropic') {
      if (!anthropicApiKey) {
        throw new Error('Anthropic API key is required when provider is "anthropic"');
      }
      this.anthropicClient = new Anthropic({ apiKey: anthropicApiKey });
      this.defaultModel = anthropicModel;
    }
  }

  /**
   * Process a natural language query about sustainability data
   */
  async processQuery(
    organizationId: string,
    userId: string,
    query: AIQuery
  ): Promise<AIResponse> {
    const startTime = Date.now();

    let response: string;
    let tokensUsed: number | undefined;

    // Build context-aware prompt
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(query);

    if (this.provider === 'openai' && this.openaiClient) {
      const completion = await this.openaiClient.chat.completions.create({
        model: this.defaultModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: query.maxTokens ?? this.defaultMaxTokens,
        temperature: query.temperature ?? this.defaultTemperature,
      });

      response = completion.choices[0]?.message?.content ?? 'No response generated';
      tokensUsed = completion.usage?.total_tokens;
    } else if (this.provider === 'anthropic' && this.anthropicClient) {
      const message = await this.anthropicClient.messages.create({
        model: this.defaultModel,
        max_tokens: query.maxTokens ?? this.defaultMaxTokens,
        temperature: query.temperature ?? this.defaultTemperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const content = message.content[0];
      response = content.type === 'text' ? content.text : 'No response generated';
      tokensUsed = message.usage.input_tokens + message.usage.output_tokens;
    } else {
      throw new Error('No AI client configured');
    }

    const processingTimeMs = Date.now() - startTime;

    // Log the interaction
    await this.logInteraction(organizationId, userId, query.query, response, tokensUsed, processingTimeMs);

    return {
      response,
      tokensUsed,
      processingTimeMs,
      model: this.defaultModel,
      provider: this.provider,
    };
  }

  /**
   * Generate sustainability insights based on emission data
   */
  async generateInsights(
    organizationId: string,
    userId: string,
    timeframe?: { startDate: Date; endDate: Date }
  ): Promise<SustainabilityInsight[]> {
    // Fetch emission data for the organization
    const emissions = await this.prisma.emissionRecord.findMany({
      where: {
        organizationId,
        ...(timeframe && {
          startDate: { gte: timeframe.startDate },
          endDate: { lte: timeframe.endDate },
        }),
      },
      orderBy: { startDate: 'desc' },
      take: 100,
    });

    if (emissions.length === 0) {
      return [];
    }

    // Prepare data summary for AI
    const dataSummary = this.summarizeEmissionData(emissions);

    const query: AIQuery = {
      query: `Analyze the following sustainability data and provide actionable insights:

${dataSummary}

Please provide 3-5 specific, actionable insights focusing on:
1. Opportunities for emission reductions
2. Cost savings through efficiency improvements
3. Risk areas that need attention
4. Strategic opportunities for sustainability leadership

Format each insight as JSON with: insight (string), category (emission_reduction|cost_savings|risk_mitigation|opportunity), priority (high|medium|low), estimatedImpact (string).`,
      maxTokens: 2000,
      temperature: 0.5,
    };

    const response = await this.processQuery(organizationId, userId, query);

    // Parse insights from response
    return this.parseInsights(response.response);
  }

  /**
   * Generate a recommendation for achieving a sustainability goal
   */
  async generateGoalRecommendations(
    organizationId: string,
    userId: string,
    goalId: string
  ): Promise<string[]> {
    const goal = await this.prisma.sustainabilityGoal.findUnique({
      where: { id: goalId },
      include: { organization: true },
    });

    if (!goal) {
      throw new Error('Goal not found');
    }

    const currentProgress = goal.progressPercent ?? 0;
    const yearsRemaining = goal.targetYear - new Date().getFullYear();

    const query: AIQuery = {
      query: `Generate specific, actionable recommendations for achieving this sustainability goal:

Goal: ${goal.name}
Description: ${goal.description ?? 'Not provided'}
Target: ${goal.reductionPercent}% reduction by ${goal.targetYear}
Current Progress: ${currentProgress}%
Years Remaining: ${yearsRemaining}
Baseline: ${goal.baselineValue} kg CO2e
Target Value: ${goal.targetValue} kg CO2e
Current Value: ${goal.currentValue ?? 'Unknown'} kg CO2e

Provide 5-7 specific, prioritized recommendations that:
1. Are practical and implementable
2. Consider the time remaining
3. Balance cost and impact
4. Build on current progress

Format as a numbered list.`,
      maxTokens: 1500,
      temperature: 0.6,
    };

    const response = await this.processQuery(organizationId, userId, query);

    // Parse recommendations from response
    return this.parseRecommendations(response.response);
  }

  /**
   * Forecast future emissions based on historical data
   */
  async forecastEmissions(
    organizationId: string,
    userId: string,
    monthsAhead: number = 12
  ): Promise<{ month: string; predicted: number; confidence: string }[]> {
    // Fetch historical emission data
    const emissions = await this.prisma.emissionRecord.findMany({
      where: { organizationId },
      orderBy: { startDate: 'desc' },
      take: 24, // Last 24 months of data
    });

    if (emissions.length < 3) {
      throw new Error('Insufficient historical data for forecasting (need at least 3 months)');
    }

    const dataSummary = this.summarizeEmissionDataForForecasting(emissions);

    const query: AIQuery = {
      query: `Based on the following historical emission data, forecast emissions for the next ${monthsAhead} months:

${dataSummary}

Provide predictions in JSON format as an array: [{"month": "YYYY-MM", "predicted": number, "confidence": "high|medium|low"}]

Consider:
- Seasonal patterns
- Growth trends
- Data quality and consistency

Provide exactly ${monthsAhead} predictions.`,
      maxTokens: 2000,
      temperature: 0.3, // Lower temperature for more consistent forecasting
    };

    const response = await this.processQuery(organizationId, userId, query);

    return this.parseForecast(response.response);
  }

  /**
   * Build system prompt for sustainability domain
   */
  private buildSystemPrompt(): string {
    return `You are an expert sustainability analyst specializing in corporate carbon accounting, ESG reporting, and environmental impact reduction. You provide data-driven, actionable insights based on emission data following GHG Protocol standards. Your responses are:

- Precise and quantitative when data allows
- Practical and implementable
- Aligned with science-based targets and climate commitments
- Focused on both environmental and business impact
- Clear and jargon-free for non-technical audiences

When analyzing emissions data:
- Consider Scope 1, 2, and 3 categories
- Reference emission factors and data quality
- Highlight areas with highest impact potential
- Suggest specific actions, not just general advice
- Consider cost-effectiveness and ROI

Always provide citations and confidence levels for your recommendations.`;
  }

  /**
   * Build user prompt with query and context
   */
  private buildUserPrompt(query: AIQuery): string {
    let prompt = query.query;

    if (query.context) {
      prompt += '\n\nAdditional Context:\n';
      prompt += JSON.stringify(query.context, null, 2);
    }

    return prompt;
  }

  /**
   * Summarize emission data for AI analysis
   */
  private summarizeEmissionData(emissions: any[]): string {
    const totalEmissions = emissions.reduce((sum, e) => sum + Number(e.totalEmissions), 0);
    const byScope = emissions.reduce((acc, e) => {
      acc[e.scope] = (acc[e.scope] || 0) + Number(e.totalEmissions);
      return acc;
    }, {} as Record<string, number>);

    const byCategory = emissions.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + Number(e.totalEmissions);
      return acc;
    }, {} as Record<string, number>);

    return `Total Emissions: ${totalEmissions.toFixed(2)} kg CO2e
Number of Records: ${emissions.length}

Emissions by Scope:
${Object.entries(byScope).map(([scope, value]) => `  ${scope}: ${value.toFixed(2)} kg CO2e`).join('\n')}

Top Emission Categories:
${Object.entries(byCategory)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 5)
  .map(([cat, value]) => `  ${cat}: ${value.toFixed(2)} kg CO2e`)
  .join('\n')}`;
  }

  /**
   * Summarize emission data for forecasting
   */
  private summarizeEmissionDataForForecasting(emissions: any[]): string {
    const monthlyData = emissions.map((e) => ({
      month: e.startDate.toISOString().slice(0, 7),
      emissions: Number(e.totalEmissions),
      scope: e.scope,
    }));

    return JSON.stringify(monthlyData, null, 2);
  }

  /**
   * Parse insights from AI response
   */
  private parseInsights(response: string): SustainabilityInsight[] {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // Fallback: parse structured text
      const insights: SustainabilityInsight[] = [];
      const lines = response.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        if (line.includes('insight') || line.match(/^\d+\./)) {
          insights.push({
            insight: line.replace(/^\d+\.\s*/, '').trim(),
            category: 'opportunity',
            priority: 'medium',
          });
        }
      }

      return insights;
    } catch (error) {
      console.error('Error parsing insights:', error);
      return [];
    }
  }

  /**
   * Parse recommendations from AI response
   */
  private parseRecommendations(response: string): string[] {
    const lines = response.split('\n').filter((l) => l.trim());
    const recommendations: string[] = [];

    for (const line of lines) {
      const match = line.match(/^\d+\.\s*(.+)/);
      if (match) {
        recommendations.push(match[1].trim());
      }
    }

    return recommendations.length > 0 ? recommendations : [response];
  }

  /**
   * Parse forecast from AI response
   */
  private parseForecast(response: string): any[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return [];
    } catch (error) {
      console.error('Error parsing forecast:', error);
      return [];
    }
  }

  /**
   * Log AI interaction to database
   */
  private async logInteraction(
    organizationId: string,
    userId: string,
    query: string,
    response: string,
    tokensUsed: number | undefined,
    processingTimeMs: number
  ): Promise<void> {
    await this.prisma.aIInteraction.create({
      data: {
        organizationId,
        userId,
        query,
        queryType: 'general',
        response,
        provider: this.provider,
        model: this.defaultModel,
        tokensUsed,
        processingTimeMs,
      },
    });
  }
}
