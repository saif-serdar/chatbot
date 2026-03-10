import cron from 'node-cron';
import { logger } from './logger';
import { summaryService } from '../services/summary.service';
import { webhookService } from '../services/webhook.service';
import { chatappService } from '../services/chatapp.service';
import { config } from '../config';

/**
 * Scheduler for periodic background tasks.
 * Note: WhatsApp message ingestion is handled in real-time via ChatApp webhooks.
 *       This scheduler only handles session summarization and message cleanup.
 */
export class Scheduler {
  private tasks: cron.ScheduledTask[] = [];

  start() {
    logger.info('Starting scheduler...');

    // Session Summary Generation
    const summaryEnabled = config.sessionSummary?.enabled !== false;
    const summaryCronInterval = config.sessionSummary?.summaryCronInterval || '*/30 * * * *';

    if (summaryEnabled && cron.validate(summaryCronInterval)) {
      const summaryTask = cron.schedule(summaryCronInterval, async () => {
        logger.info('Running scheduled session summarization...');
        try {
          const results = await summaryService.summarizeInactiveSessions();
          logger.info(`Session summarization: ${results.summarized} summarized, ${results.skipped} skipped, ${results.failed} failed`);
        } catch (err: any) {
          logger.error('Error in session summarization:', err.message);
        }
      });

      this.tasks.push(summaryTask);
      logger.info(`Session summarization scheduled: ${summaryCronInterval}`);
    }

    // Message Cleanup
    const cleanupEnabled = config.sessionSummary?.cleanupEnabled !== false;
    const cleanupCronSchedule = config.sessionSummary?.cleanupCronSchedule || '0 2 * * *';

    if (cleanupEnabled && cron.validate(cleanupCronSchedule)) {
      const cleanupTask = cron.schedule(cleanupCronSchedule, async () => {
        logger.info('Running scheduled message cleanup...');
        try {
          const results = await summaryService.cleanupOldMessages();
          logger.info(`Message cleanup: ${results.messagesDeleted} deleted from ${results.sessionsProcessed} sessions`);
        } catch (err: any) {
          logger.error('Error in message cleanup:', err.message);
        }
      });

      this.tasks.push(cleanupTask);
      logger.info(`Message cleanup scheduled: ${cleanupCronSchedule}`);
    }

    // Transcription Retry (calls + WhatsApp voice)
    const retryEnabled = config.transcriptionRetry?.enabled !== false;
    const retryCron = config.transcriptionRetry?.cronInterval || '*/15 * * * *';

    if (retryEnabled && cron.validate(retryCron)) {
      const retryTask = cron.schedule(retryCron, async () => {
        logger.info('Running transcription retry...');
        try {
          const callLookbackDays = config.transcriptionRetry?.callLookbackDays ?? 7;
          const voiceLookbackHours = config.transcriptionRetry?.voiceLookbackHours ?? 24;

          const [callResult, voiceResult] = await Promise.all([
            webhookService.retryCallTranscriptions(callLookbackDays),
            chatappService.retryVoiceTranscriptions(voiceLookbackHours),
          ]);

          if (callResult.retried > 0) {
            logger.info(`Call retry: ${callResult.retried} attempted, ${callResult.succeeded} succeeded, ${callResult.failed} failed`);
          }
          if (voiceResult.retried > 0) {
            logger.info(`Voice retry: ${voiceResult.retried} attempted, ${voiceResult.succeeded} succeeded, ${voiceResult.failed} failed`);
          }
        } catch (err: any) {
          logger.error('Error in transcription retry:', err.message);
        }
      });

      this.tasks.push(retryTask);
      logger.info(`Transcription retry scheduled: ${retryCron}`);
    }

    logger.info(`Scheduler started with ${this.tasks.length} active tasks`);
  }

  stop() {
    logger.info('Stopping scheduler...');
    this.tasks.forEach((task) => task.stop());
    this.tasks = [];
    logger.info('Scheduler stopped');
  }
}

export const scheduler = new Scheduler();
