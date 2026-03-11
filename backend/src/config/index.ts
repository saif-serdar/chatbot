import dotenv from 'dotenv';

// Load environment variables from backend/.env
dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Database
  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres123@localhost:5432/chatbot',
  },

  // Qdrant
  qdrant: {
    host: process.env.QDRANT_HOST || 'localhost',
    port: parseInt(process.env.QDRANT_PORT || '6333', 10),
    collectionName: process.env.QDRANT_COLLECTION_NAME || 'lead_conversations',
  },

  // API Keys
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
    whisperModel: process.env.WHISPER_MODEL || 'whisper-1',
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Bitrix24
  bitrix24: {
    webhookUrl: process.env.BITRIX24_WEBHOOK_URL || '', // Full inbound webhook URL (contains domain + auth token)
  },

  // Session Summary
  sessionSummary: {
    enabled: process.env.ENABLE_SESSION_SUMMARY !== 'false', // Default: enabled
    inactivityHours: parseFloat(process.env.SESSION_INACTIVITY_HOURS || '2'), // Default: 2 hours (supports decimals)
    summaryCronInterval: process.env.SUMMARY_CRON_INTERVAL || '*/30 * * * *', // Default: every 30 minutes
    minMessages: parseInt(process.env.SUMMARY_MIN_MESSAGES || '2', 10), // Default: min 2 messages
    cleanupEnabled: process.env.ENABLE_MESSAGE_CLEANUP !== 'false', // Default: enabled
    cleanupAfterDays: parseInt(process.env.CLEANUP_AFTER_DAYS || '30', 10), // Default: 30 days
    cleanupCronSchedule: process.env.CLEANUP_CRON_SCHEDULE || '0 2 * * *', // Default: 2 AM daily
  },

  // Transcription Retry
  transcriptionRetry: {
    enabled: process.env.ENABLE_TRANSCRIPTION_RETRY !== 'false',                    // Default: enabled
    cronInterval: process.env.TRANSCRIPTION_RETRY_CRON || '*/15 * * * *',          // Default: every 15 minutes
    callLookbackDays: parseInt(process.env.CALL_RETRY_LOOKBACK_DAYS || '7', 10),   // Default: retry calls up to 7 days old
    voiceLookbackHours: parseInt(process.env.VOICE_RETRY_LOOKBACK_HOURS || '24', 10), // Default: retry voice up to 24h old
  },

  // Conversation Summary (periodic WhatsApp + call summary per lead)
  conversationSummary: {
    enabled: process.env.ENABLE_CONVERSATION_SUMMARY !== 'false',                         // Default: enabled
    cronInterval: process.env.CONVERSATION_SUMMARY_CRON || '*/30 * * * *',               // Default: every 30 minutes
    lookbackHours: parseInt(process.env.CONVERSATION_SUMMARY_LOOKBACK_HOURS || '24', 10), // Default: 24h for first-time leads
  },

  // Admin credentials
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@serdar.ae',
    password: process.env.ADMIN_PASSWORD || 'Admin@123456',
  },

  // ChatApp
  chatapp: {
    email: process.env.CHATAPP_EMAIL || '',
    password: process.env.CHATAPP_PASSWORD || '',
    appId: process.env.CHATAPP_APP_ID || '',
    apiBaseUrl: 'https://api.chatapp.online',
  },

};

// Validate critical configurations
export function validateConfig() {
  const errors: string[] = [];

  if (!config.jwt.secret || config.jwt.secret === 'your_super_secret_jwt_key_change_this') {
    errors.push('JWT_SECRET is not set or using default value');
  }

  if (!config.anthropic.apiKey) {
    errors.push('ANTHROPIC_API_KEY is not set');
  }

  if (!config.openai.apiKey) {
    errors.push('OPENAI_API_KEY is not set');
  }

  if (errors.length > 0 && config.nodeEnv === 'production') {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }

  if (errors.length > 0) {
    console.warn('⚠️  Configuration warnings:');
    errors.forEach(err => console.warn(`   - ${err}`));
  }
}
