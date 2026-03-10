import { createApp } from './app';
import { config, validateConfig } from './config';
import { logger } from './utils/logger';
import { qdrantService } from './services/qdrant.service';
import { scheduler } from './utils/scheduler';
import { chatappService } from './services/chatapp.service';
import { prisma } from './lib/prisma';

async function startServer() {
  try {
    // Validate configuration
    validateConfig();

    // Initialize Qdrant collection
    logger.info('Initializing Qdrant...');
    await qdrantService.initialize();

    // Test database connection
    logger.info('Testing database connection...');
    await prisma.$connect();
    logger.info('Database connected successfully');

    // Create Express app
    const app = createApp();

    // Start scheduler (background jobs)
    logger.info('Starting scheduler...');
    scheduler.start();

    // Start server
    const PORT = config.port;
    app.listen(PORT, () => {
      logger.info(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🤖  Bitrix24 Lead Assistant Chatbot                ║
║                                                       ║
║   Server running on: http://localhost:${PORT}        ║
║   Environment: ${config.nodeEnv}                     ║
║   Frontend URL: ${config.frontendUrl}                ║
║                                                       ║
║   API Endpoints:                                      ║
║   - Health Check: http://localhost:${PORT}/health    ║
║   - API Docs: http://localhost:${PORT}/api           ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received. Shutting down gracefully...');
      scheduler.stop();
      await prisma.$disconnect();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received. Shutting down gracefully...');
      scheduler.stop();
      await prisma.$disconnect();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
