/**
 * Application Configuration
 *
 * Initializes the EcoMetrics Sustainability Platform with database connections
 * and all sustainability services including AI-powered analytics.
 */

import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { config } from './config/index.js';

// Import sustainability services
import { AIService } from './services/ai.service.js';
import { CarbonTrackingService } from './services/carbon-tracking.service.js';
import { SustainabilityGoalsService } from './services/sustainability-goals.service.js';

// Import existing services that are still relevant
import { AuditService } from './services/audit.service.js';
import { UserService } from './services/user.service.js';

// =============================================================================
// Initialize Database Clients
// =============================================================================

/**
 * The Prisma client for database operations.
 */
export const prisma = new PrismaClient({
  log: config.app.nodeEnv === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

/**
 * The Redis client for caching and session management.
 */
export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number): number {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
});

// =============================================================================
// Initialize Services
// =============================================================================

/**
 * AI Service for natural language queries and intelligent insights.
 */
export const aiService = new AIService(
  prisma,
  config.ai.provider,
  config.ai.openaiApiKey,
  config.ai.openaiModel,
  config.ai.anthropicApiKey,
  config.ai.anthropicModel,
  config.ai.maxTokens,
  config.ai.temperature
);

/**
 * Carbon Tracking Service for emission data management.
 */
export const carbonTrackingService = new CarbonTrackingService(prisma);

/**
 * Sustainability Goals Service for target management and progress tracking.
 */
export const sustainabilityGoalsService = new SustainabilityGoalsService(prisma);

/**
 * Audit Service for comprehensive audit logging.
 */
export const auditService = new AuditService(prisma);

/**
 * User Service for user management.
 */
export const userService = new UserService(prisma);

// =============================================================================
// Service Container
// =============================================================================

/**
 * Container object with all initialized services.
 * Useful for dependency injection in API routes and handlers.
 */
export const services = {
  ai: aiService,
  carbonTracking: carbonTrackingService,
  sustainabilityGoals: sustainabilityGoalsService,
  audit: auditService,
  user: userService,
} as const;

/**
 * Type for the services container.
 */
export type Services = typeof services;

// =============================================================================
// Graceful Shutdown
// =============================================================================

/**
 * Disconnect all clients gracefully.
 * Call this during application shutdown.
 */
export async function disconnectClients(): Promise<void> {
  console.log('Disconnecting database and Redis clients...');

  try {
    await prisma.$disconnect();
    console.log('Prisma client disconnected');
  } catch (error) {
    console.error('Error disconnecting Prisma:', error);
  }

  try {
    await redis.quit();
    console.log('Redis client disconnected');
  } catch (error) {
    console.error('Error disconnecting Redis:', error);
  }
}

/**
 * Connect to Redis.
 * Call this during application startup.
 */
export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
    console.log('Redis client connected');
  } catch (error) {
    // Redis might already be connected via lazy connect
    if ((error as Error).message?.includes('already')) {
      console.log('Redis client already connected');
    } else {
      throw error;
    }
  }
}
