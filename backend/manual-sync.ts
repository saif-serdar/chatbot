import { bitrix24SyncService } from './src/services/bitrix-sync.service';
import { PrismaClient } from '@prisma/client';
import { logger } from './src/utils/logger';

const prisma = new PrismaClient();

async function manualSync() {
  try {
    logger.info('🔄 Starting manual Bitrix24 sync...');

    // Get the first agent (or specify agent ID)
    const agent = await prisma.agent.findFirst();

    if (!agent) {
      logger.error('No agents found in database. Please create an agent first.');
      process.exit(1);
    }

    logger.info(`Using agent: ${agent.name} (${agent.id})`);

    // Sync ALL messages (last 30 days)
    const hoursLookback = 720; // 30 days
    logger.info(`Syncing last ${hoursLookback} hours (${hoursLookback / 24} days)...`);

    const result = await bitrix24SyncService.syncAllLeads(agent.id, hoursLookback);

    logger.info('✅ Sync completed!');
    logger.info(`Leads checked: ${result.leadsChecked}`);
    logger.info(`Leads with messages: ${result.leadsProcessed}`);
    logger.info(`Total messages synced: ${result.messagesProcessed}`);

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Error during manual sync:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

manualSync();
