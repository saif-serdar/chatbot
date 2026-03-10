import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Bitrix24 API utility service.
 * ChatApp now handles real-time message delivery via webhooks.
 * This service provides helper methods for querying Bitrix24 CRM data.
 */
class Bitrix24SyncService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.bitrix24.webhookUrl;
  }

  async makeRequest(method: string, params: any = {}) {
    try {
      const url = `${this.baseUrl}${method}.json`;
      const response = await axios.post(url, params);

      if (response.data.error) {
        throw new Error(`Bitrix24 API Error: ${response.data.error_description}`);
      }

      return response.data.result;
    } catch (error: any) {
      logger.error(`Bitrix24 API call failed [${method}]:`, error.message);
      throw error;
    }
  }

  async getLeads(filter: any = {}) {
    return this.makeRequest('crm.lead.list', {
      filter,
      select: ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'STATUS_ID', 'DATE_MODIFY', 'PHONE', 'EMAIL', 'ASSIGNED_BY_ID'],
    });
  }

  // Kept for backward compatibility with sync.routes.ts — no longer polls Wazzup messages
  async syncAllLeads(_agentId: string, _hoursLookback: number = 2) {
    logger.info('Bitrix24 message sync is disabled. Messages are now received in real-time via ChatApp webhook.');
    return { success: true, message: 'Sync disabled — using ChatApp webhooks', leadsChecked: 0, messagesProcessed: 0 };
  }

  async syncLead(_leadBitrixId: string, _agentId: string, _hoursLookback: number = 2) {
    logger.info('Bitrix24 lead sync is disabled. Messages are now received in real-time via ChatApp webhook.');
    return { processed: 0 };
  }
}

export const bitrix24SyncService = new Bitrix24SyncService();
