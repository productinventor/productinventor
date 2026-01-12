/**
 * Application Entry Point
 *
 * Initializes the EcoMetrics Sustainability Platform, connects to databases,
 * and starts the application server.
 */

import { prisma, redis, disconnectClients, connectRedis, services } from './app.js';
import { config, validateConfig } from './config/index.js';
import express from 'express';

const app = express();

// Middleware
app.use(express.json());

// =============================================================================
// Health Check Endpoint
// =============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'EcoMetrics Sustainability Platform',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// API Routes
// =============================================================================

/**
 * Query natural language endpoint
 */
app.post('/api/ai/query', async (req, res) => {
  try {
    const { organizationId, userId, query } = req.body;

    if (!organizationId || !userId || !query) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const response = await services.ai.processQuery(organizationId, userId, { query });
    res.json(response);
  } catch (error) {
    console.error('AI query error:', error);
    res.status(500).json({ error: 'Failed to process query' });
  }
});

/**
 * Get sustainability insights
 */
app.post('/api/ai/insights', async (req, res) => {
  try {
    const { organizationId, userId, startDate, endDate } = req.body;

    if (!organizationId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const timeframe = startDate && endDate
      ? { startDate: new Date(startDate), endDate: new Date(endDate) }
      : undefined;

    const insights = await services.ai.generateInsights(organizationId, userId, timeframe);
    res.json({ insights });
  } catch (error) {
    console.error('Insights generation error:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

/**
 * Get emission summary
 */
app.get('/api/emissions/summary/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { startDate, endDate } = req.query;

    const summary = await services.carbonTracking.getEmissionSummary(
      organizationId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );

    res.json(summary);
  } catch (error) {
    console.error('Emission summary error:', error);
    res.status(500).json({ error: 'Failed to get emission summary' });
  }
});

/**
 * Create emission record
 */
app.post('/api/emissions', async (req, res) => {
  try {
    const { organizationId, userId, ...emissionData } = req.body;

    if (!organizationId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Parse dates
    emissionData.startDate = new Date(emissionData.startDate);
    emissionData.endDate = new Date(emissionData.endDate);

    const record = await services.carbonTracking.createEmissionRecord(
      organizationId,
      userId,
      emissionData
    );

    res.status(201).json(record);
  } catch (error) {
    console.error('Create emission error:', error);
    res.status(500).json({ error: 'Failed to create emission record' });
  }
});

/**
 * Get sustainability goals
 */
app.get('/api/goals/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { status } = req.query;

    const goals = await services.sustainabilityGoals.getOrganizationGoals(
      organizationId,
      status as any
    );

    res.json({ goals });
  } catch (error) {
    console.error('Get goals error:', error);
    res.status(500).json({ error: 'Failed to get goals' });
  }
});

/**
 * Create sustainability goal
 */
app.post('/api/goals', async (req, res) => {
  try {
    const { organizationId, ...goalData } = req.body;

    if (!organizationId) {
      return res.status(400).json({ error: 'Missing organizationId' });
    }

    const goal = await services.sustainabilityGoals.createGoal(organizationId, goalData);

    res.status(201).json(goal);
  } catch (error) {
    console.error('Create goal error:', error);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

// =============================================================================
// Startup
// =============================================================================

/**
 * Start the application.
 */
async function start(): Promise<void> {
  console.log('Starting EcoMetrics Sustainability Platform...');

  // Validate configuration first
  try {
    validateConfig();
    console.log('Configuration validated successfully');
  } catch (error) {
    console.error('Configuration error:', error);
    process.exit(1);
  }

  // Connect to Redis
  try {
    await connectRedis();
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    process.exit(1);
  }

  // Test database connection
  try {
    await prisma.$connect();
    console.log('Database connection established');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  }

  // Start the HTTP server
  const port = config.app.port;
  app.listen(port, () => {
    console.log('');
    console.log('='.repeat(60));
    console.log('EcoMetrics Sustainability Platform is running!');
    console.log('='.repeat(60));
    console.log(`Environment: ${config.app.nodeEnv}`);
    console.log(`Port: ${port}`);
    console.log(`AI Provider: ${config.ai.provider}`);
    console.log(`AI Model: ${config.ai.provider === 'openai' ? config.ai.openaiModel : config.ai.anthropicModel}`);
    console.log(`Features Enabled:`);
    console.log(`  - Supply Chain: ${config.features.supplyChainEnabled}`);
    console.log(`  - Predictive Analytics: ${config.features.predictiveAnalyticsEnabled}`);
    console.log(`  - Natural Language Queries: ${config.features.nlqEnabled}`);
    console.log(`  - ESG Reporting: ${config.features.esgReportingEnabled}`);
    console.log('='.repeat(60));
    console.log('');
    console.log('API Endpoints:');
    console.log(`  GET  /health - Health check`);
    console.log(`  POST /api/ai/query - Natural language queries`);
    console.log(`  POST /api/ai/insights - Generate sustainability insights`);
    console.log(`  GET  /api/emissions/summary/:orgId - Get emission summary`);
    console.log(`  POST /api/emissions - Create emission record`);
    console.log(`  GET  /api/goals/:orgId - Get sustainability goals`);
    console.log(`  POST /api/goals - Create sustainability goal`);
    console.log('='.repeat(60));
    console.log('');
  });
}

// =============================================================================
// Graceful Shutdown
// =============================================================================

/**
 * Handle graceful shutdown.
 * Disconnects database and Redis clients before exiting.
 *
 * @param signal - The signal that triggered the shutdown
 */
async function handleShutdown(signal: string): Promise<void> {
  console.log('');
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Disconnect clients
    await disconnectClients();

    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);
  handleShutdown('uncaughtException').catch(() => process.exit(1));
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  handleShutdown('unhandledRejection').catch(() => process.exit(1));
});

// =============================================================================
// Run
// =============================================================================

start().catch((error) => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});

// Export for testing
export { start, handleShutdown };
