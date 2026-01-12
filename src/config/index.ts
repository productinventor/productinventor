/**
 * Configuration management for EcoMetrics Sustainability Platform.
 *
 * Loads and validates environment variables, providing a typed configuration
 * object for the application. Throws errors if required variables are missing.
 */

/**
 * Encryption mode options
 */
export type EncryptionMode = 'standard' | 'encrypted';

/**
 * AI provider options
 */
export type AIProvider = 'openai' | 'anthropic';

/**
 * Slack configuration (optional for sustainability platform)
 */
export interface SlackConfig {
  botToken?: string;
  signingSecret?: string;
  appToken?: string;
  webhookUrl?: string;
}

/**
 * AI service configuration
 */
export interface AIConfig {
  provider: AIProvider;
  openaiApiKey?: string;
  openaiModel: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  maxTokens: number;
  temperature: number;
}

/**
 * Sustainability configuration
 */
export interface SustainabilityConfig {
  emissionFactorsVersion: string;
  defaultGridIntensity: number;
  dataQualityScoringEnabled: boolean;
}

/**
 * Feature flags configuration
 */
export interface FeatureFlags {
  supplyChainEnabled: boolean;
  predictiveAnalyticsEnabled: boolean;
  nlqEnabled: boolean;
  esgReportingEnabled: boolean;
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  url: string;
}

/**
 * Redis configuration
 */
export interface RedisConfig {
  url: string;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  path: string;
}

/**
 * Encryption configuration
 */
export interface EncryptionConfig {
  masterKey: Buffer;
  mode: EncryptionMode;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  downloadTokenExpiry: number;
  secureDeleteEnabled: boolean;
}

/**
 * Audit configuration
 */
export interface AuditConfig {
  retentionYears: number;
  archiveEnabled: boolean;
  archivePath: string;
}

/**
 * Application configuration
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  lockExpiryHours: number;
}

/**
 * Complete application configuration
 */
export interface Config {
  slack: SlackConfig;
  ai: AIConfig;
  sustainability: SustainabilityConfig;
  features: FeatureFlags;
  database: DatabaseConfig;
  redis: RedisConfig;
  storage: StorageConfig;
  encryption: EncryptionConfig;
  security: SecurityConfig;
  audit: AuditConfig;
  app: AppConfig;
}

/**
 * Get a required environment variable.
 * Throws an error if the variable is not set.
 *
 * @param name - The name of the environment variable
 * @returns The value of the environment variable
 * @throws Error if the variable is not set
 */
function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Get an optional environment variable with a default value.
 *
 * @param name - The name of the environment variable
 * @param defaultValue - The default value to use if not set
 * @returns The value of the environment variable or the default
 */
function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

/**
 * Get an optional environment variable as an integer.
 *
 * @param name - The name of the environment variable
 * @param defaultValue - The default value to use if not set
 * @returns The integer value or default
 */
function getOptionalInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid integer`);
  }
  return parsed;
}

/**
 * Get an optional environment variable as a boolean.
 *
 * @param name - The name of the environment variable
 * @param defaultValue - The default value to use if not set
 * @returns The boolean value or default
 */
function getOptionalBool(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse the master key from base64.
 *
 * @param base64Key - The base64-encoded master key
 * @returns The decoded key as a Buffer
 * @throws Error if the key is invalid or wrong length
 */
function parseMasterKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `Master key must be exactly 32 bytes (256 bits), got ${key.length} bytes. ` +
        'Generate with: openssl rand -base64 32'
    );
  }
  return key;
}

/**
 * Load and validate the application configuration.
 *
 * @returns The validated configuration object
 * @throws Error if required variables are missing or invalid
 */
function loadConfig(): Config {
  // Load Slack configuration (optional)
  const slack: SlackConfig = {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
  };

  // Load AI configuration
  const aiProvider = getOptionalEnv('AI_PROVIDER', 'openai') as AIProvider;
  if (aiProvider !== 'openai' && aiProvider !== 'anthropic') {
    throw new Error('AI_PROVIDER must be either "openai" or "anthropic"');
  }

  const ai: AIConfig = {
    provider: aiProvider,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: getOptionalEnv('OPENAI_MODEL', 'gpt-4-turbo-preview'),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: getOptionalEnv('ANTHROPIC_MODEL', 'claude-3-sonnet-20240229'),
    maxTokens: getOptionalInt('AI_MAX_TOKENS', 4096),
    temperature: parseFloat(getOptionalEnv('AI_TEMPERATURE', '0.7')),
  };

  // Validate that the selected provider has an API key
  if (aiProvider === 'openai' && !ai.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required when AI_PROVIDER is "openai"');
  }
  if (aiProvider === 'anthropic' && !ai.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required when AI_PROVIDER is "anthropic"');
  }

  // Load sustainability configuration
  const sustainability: SustainabilityConfig = {
    emissionFactorsVersion: getOptionalEnv('EMISSION_FACTORS_VERSION', '2024.1'),
    defaultGridIntensity: parseFloat(getOptionalEnv('DEFAULT_GRID_INTENSITY', '0.475')),
    dataQualityScoringEnabled: getOptionalBool('DATA_QUALITY_SCORING_ENABLED', true),
  };

  // Load feature flags
  const features: FeatureFlags = {
    supplyChainEnabled: getOptionalBool('SUPPLY_CHAIN_ENABLED', true),
    predictiveAnalyticsEnabled: getOptionalBool('PREDICTIVE_ANALYTICS_ENABLED', true),
    nlqEnabled: getOptionalBool('NLQ_ENABLED', true),
    esgReportingEnabled: getOptionalBool('ESG_REPORTING_ENABLED', true),
  };

  // Load database configuration
  const database: DatabaseConfig = {
    url: getRequiredEnv('DATABASE_URL'),
  };

  // Load Redis configuration
  const redis: RedisConfig = {
    url: getOptionalEnv('REDIS_URL', 'redis://localhost:6379'),
  };

  // Load storage configuration
  const storage: StorageConfig = {
    path: getOptionalEnv('STORAGE_PATH', './storage'),
  };

  // Load encryption configuration
  const encryptionMode = getOptionalEnv('ENCRYPTION_MODE', 'standard') as EncryptionMode;
  if (encryptionMode !== 'standard' && encryptionMode !== 'encrypted') {
    throw new Error('ENCRYPTION_MODE must be either "standard" or "encrypted"');
  }

  // Master key is only required if encryption mode is 'encrypted'
  let masterKey: Buffer;
  if (encryptionMode === 'encrypted') {
    const masterKeyBase64 = getRequiredEnv('ENCRYPTION_MASTER_KEY');
    masterKey = parseMasterKey(masterKeyBase64);
  } else {
    // For standard mode, use a dummy key (not used for encryption)
    const masterKeyBase64 = getOptionalEnv('ENCRYPTION_MASTER_KEY', '');
    masterKey = masterKeyBase64 ? parseMasterKey(masterKeyBase64) : Buffer.alloc(32);
  }

  const encryption: EncryptionConfig = {
    masterKey,
    mode: encryptionMode,
  };

  // Load security configuration
  const security: SecurityConfig = {
    downloadTokenExpiry: getOptionalInt('DOWNLOAD_TOKEN_EXPIRY_SECONDS', 300),
    secureDeleteEnabled: getOptionalBool('SECURE_DELETE_ENABLED', true),
  };

  // Load audit configuration
  const audit: AuditConfig = {
    retentionYears: getOptionalInt('AUDIT_RETENTION_YEARS', 7),
    archiveEnabled: getOptionalBool('AUDIT_ARCHIVE_ENABLED', false),
    archivePath: getOptionalEnv('AUDIT_ARCHIVE_PATH', './audit-archive'),
  };

  // Load application configuration
  const app: AppConfig = {
    nodeEnv: getOptionalEnv('NODE_ENV', 'development'),
    port: getOptionalInt('PORT', 3000),
    lockExpiryHours: getOptionalInt('LOCK_EXPIRY_HOURS', 24),
  };

  return {
    slack,
    ai,
    sustainability,
    features,
    database,
    redis,
    storage,
    encryption,
    security,
    audit,
    app,
  };
}

/**
 * Validate that all required configuration is present.
 * Call this at startup to fail fast if configuration is invalid.
 *
 * @throws Error if configuration is invalid
 */
export function validateConfig(): void {
  loadConfig();
}

/**
 * The application configuration.
 * Loaded lazily on first access.
 */
let cachedConfig: Config | null = null;

/**
 * Get the application configuration.
 * Configuration is loaded and validated on first access, then cached.
 *
 * @returns The validated configuration object
 * @throws Error if configuration is invalid
 */
export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * The exported configuration object.
 * Use this for direct access to configuration values.
 */
export const config = new Proxy({} as Config, {
  get(_target, prop: keyof Config) {
    return getConfig()[prop];
  },
});

export default config;
