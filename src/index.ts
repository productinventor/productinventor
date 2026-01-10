/**
 * Application Entry Point
 *
 * Initializes the Slack file checkout system, registers all listeners,
 * starts the application, and handles graceful shutdown.
 */

import { app, prisma, redis, disconnectClients, connectRedis, services } from './app.js';
import { config, validateConfig } from './config/index.js';
// import { registerListeners } from './listeners/index.js';

// =============================================================================
// Startup
// =============================================================================

/**
 * Start the application.
 */
async function start(): Promise<void> {
  console.log('Starting Slack File Checkout System...');

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

  // Register all Slack event listeners
  // Note: Uncomment the import and the line below once listeners are implemented
  // registerListeners(app, services);
  console.log('Event listeners registration ready (uncomment when listeners are implemented)');

  // Start the Bolt app
  try {
    await app.start();
    console.log('');
    console.log('='.repeat(60));
    console.log('Slack File Checkout System is running!');
    console.log('='.repeat(60));
    console.log(`Environment: ${config.app.nodeEnv}`);
    console.log(`Port: ${config.app.port}`);
    console.log(`Storage Path: ${config.storage.path}`);
    console.log(`Encryption Mode: ${config.encryption.mode}`);
    console.log(`Secure Delete: ${config.security.secureDeleteEnabled ? 'enabled' : 'disabled'}`);
    console.log(`Lock Expiry: ${config.app.lockExpiryHours} hours`);
    console.log('='.repeat(60));
    console.log('');
  } catch (error) {
    console.error('Failed to start Bolt app:', error);
    process.exit(1);
  }
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
    // Stop accepting new connections
    await app.stop();
    console.log('Stopped accepting new connections');

    // Clean up expired locks before shutdown
    try {
      const cleanedLocks = await services.lock.cleanupExpiredLocks();
      if (cleanedLocks > 0) {
        console.log(`Cleaned up ${cleanedLocks} expired locks`);
      }
    } catch (error) {
      console.error('Error cleaning up locks:', error);
    }

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
