import { Agent, Lead } from '@prisma/client';
import OpenAI, { toFile } from 'openai';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../utils/logger';
import { embeddingService } from './embedding.service';
import { qdrantService } from './qdrant.service';
import { prisma } from '../lib/prisma';
const openai = new OpenAI({ apiKey: config.openai.apiKey });

class ChatAppService {
  private authToken: string | null = null;
  private tokenExpiry: number = 0;

  // ─── ChatApp Authentication ───────────────────────────────────────────────

  private async getToken(): Promise<string> {
    if (this.authToken && Date.now() < this.tokenExpiry) {
      return this.authToken;
    }

    const res = await axios.post(`${config.chatapp.apiBaseUrl}/v1/tokens`, {
      email: config.chatapp.email,
      password: config.chatapp.password,
      appId: config.chatapp.appId,
    });

    const token = res.data?.data?.accessToken;
    if (!token) throw new Error('ChatApp authentication failed');

    this.authToken = token;
    this.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23h
    return token;
  }

  // ─── Bitrix24 API helper ──────────────────────────────────────────────────

  private async bitrixRequest(method: string, params: any = {}): Promise<any> {
    const url = `${config.bitrix24.webhookUrl}${method}.json`;
    const res = await axios.post(url, params);
    if (res.data.error) throw new Error(`Bitrix24 ${method}: ${res.data.error_description}`);
    return res.data.result;
  }

  // ─── Bitrix24 lead search by phone (tries multiple formats) ──────────────

  // Closed statuses in Bitrix24 — leads in these stages are deprioritised
  private readonly CLOSED_STATUSES = new Set(['PROCESSED', 'CONVERTED', 'JUNK', 'DEAD']);

  private async findBitrixLead(phone: string, bitrixUserId: string): Promise<any | null> {
    // Bitrix24 stores phones with + prefix; ChatApp sends without it.
    // Always try +<phone> first, then bare number as fallback.
    const withPlus = phone.startsWith('+') ? phone : `+${phone}`;
    const withoutPlus = phone.startsWith('+') ? phone.slice(1) : phone;
    const variants = Array.from(new Set([withPlus, withoutPlus]));

    for (const variant of variants) {
      const results = await this.bitrixRequest('crm.lead.list', {
        filter: { PHONE: variant, ASSIGNED_BY_ID: bitrixUserId },
        select: ['ID', 'NAME', 'LAST_NAME', 'TITLE', 'STATUS_ID', 'DATE_MODIFY'],
        order: { DATE_MODIFY: 'DESC' }, // most recently modified first
      });
      if (!results || results.length === 0) continue;

      // Option 1+2: prefer open leads over closed, most recent within each group
      const open   = results.filter((l: any) => !this.CLOSED_STATUSES.has(l.STATUS_ID));
      const closed = results.filter((l: any) =>  this.CLOSED_STATUSES.has(l.STATUS_ID));

      // Already sorted by DATE_MODIFY DESC — just take the first open, fallback to first closed
      return open[0] ?? closed[0];
    }

    return null;
  }

  // ─── Resolve Agent ────────────────────────────────────────────────────────
  // Maps ChatApp responsible.id → Agent in our DB via chatappUserId set in admin panel.
  // Returns null if not mapped — message will be skipped.

  private async resolveAgent(responsibleId: string): Promise<Agent | null> {
    const mapped = await prisma.agent.findFirst({ where: { chatappUserId: responsibleId } });
    if (mapped) return mapped;

    logger.info(`Skipping message: chatappUserId=${responsibleId} is not mapped to any agent.`);
    return null;
  }

  // ─── Resolve Lead ─────────────────────────────────────────────────────────
  // 1. Instant lookup by chatappChatId (cached after first message)
  // 2. Phone + agent lookup in our DB
  // 3. Bitrix24 API query by phone + ASSIGNED_BY_ID
  // 4. Create minimal lead if still not found

  private async resolveLead(chatId: string, phone: string, agent: Agent): Promise<Lead | null> {
    // 1. Fast path: cached chatId
    const byChatId = await prisma.lead.findFirst({
      where: { chatappChatId: chatId, agentId: agent.id },
    });
    if (byChatId) {
      // If lead exists but has no bitrixLeadId yet, try to backfill it from Bitrix24
      if (!byChatId.bitrixLeadId && phone) {
        const updated = await this.tryFillBitrixLeadId(byChatId, phone, agent);
        return updated ?? null;
      }

      // Always re-check Bitrix24 for the best lead (open + most recent).
      // If a different lead is returned, update the cache automatically.
      if (phone) {
        try {
          const bl = await this.findBitrixLead(phone, agent.bitrixUserId);
          if (bl && String(bl.ID) !== byChatId.bitrixLeadId) {
            logger.info(`Switching chat ${chatId} from lead ${byChatId.bitrixLeadId} to newer/better lead ${bl.ID}.`);
            await prisma.lead.update({ where: { id: byChatId.id }, data: { chatappChatId: null } });
            return prisma.lead.upsert({
              where: { bitrixLeadId: String(bl.ID) },
              update: {
                chatappChatId: chatId,
                name: `${bl.NAME || ''} ${bl.LAST_NAME || ''}`.trim() || bl.TITLE || phone,
                status: bl.STATUS_ID || null,
              },
              create: {
                bitrixLeadId: String(bl.ID),
                agentId: agent.id,
                name: `${bl.NAME || ''} ${bl.LAST_NAME || ''}`.trim() || bl.TITLE || phone,
                phone,
                chatappChatId: chatId,
                status: bl.STATUS_ID || null,
                source: 'chatapp',
              },
            });
          }
          // Same lead returned — update status in DB to keep it fresh
          if (bl && bl.STATUS_ID && bl.STATUS_ID !== byChatId.status) {
            await prisma.lead.update({ where: { id: byChatId.id }, data: { status: bl.STATUS_ID } });
          }
        } catch (err: any) {
          logger.warn(`Re-check Bitrix24 failed for cached lead ${byChatId.bitrixLeadId}: ${err.message}`);
        }
      }

      return byChatId;
    }

    // 2. Match by phone in our DB → cache chatId
    if (phone) {
      const byPhone = await prisma.lead.findFirst({
        where: { phone: { contains: phone }, agentId: agent.id },
      });
      if (byPhone) {
        const updated = await prisma.lead.update({
          where: { id: byPhone.id },
          data: { chatappChatId: chatId },
        });
        // Backfill bitrixLeadId if missing
        if (!updated.bitrixLeadId) {
          const filled = await this.tryFillBitrixLeadId(updated, phone, agent);
          return filled ?? null;
        }
        return updated;
      }
    }

    // 3. Query Bitrix24 by phone + assigned agent
    if (phone) {
      try {
        const bl = await this.findBitrixLead(phone, agent.bitrixUserId);
        if (bl) {
          return prisma.lead.create({
            data: {
              bitrixLeadId: String(bl.ID),
              agentId: agent.id,
              name: `${bl.NAME || ''} ${bl.LAST_NAME || ''}`.trim() || bl.TITLE || phone,
              phone,
              chatappChatId: chatId,
              status: bl.STATUS_ID || null,
              source: 'chatapp',
            },
          });
        }
        logger.warn(`Bitrix24 returned no leads for phone="${phone}", agent bitrixUserId=${agent.bitrixUserId}`);
      } catch (err: any) {
        logger.warn(`Bitrix24 lead lookup failed for phone=${phone}: ${err.message}`);
      }
    }

    // No CRM lead found — skip this message
    logger.info(`Skipping message: phone=${phone} has no lead in Bitrix24 CRM`);
    return null;
  }

  // ─── Backfill bitrixLeadId on existing leads ──────────────────────────────

  private async tryFillBitrixLeadId(lead: Lead, phone: string, agent: Agent): Promise<Lead | null> {
    try {
      const bl = await this.findBitrixLead(phone, agent.bitrixUserId);
      if (bl) {
        const updated = await prisma.lead.update({
          where: { id: lead.id },
          data: {
            bitrixLeadId: String(bl.ID),
            name: `${bl.NAME || ''} ${bl.LAST_NAME || ''}`.trim() || bl.TITLE || lead.name,
            status: bl.STATUS_ID || lead.status,
            source: 'chatapp',
          },
        });
        logger.info(`Backfilled bitrixLeadId=${bl.ID} for lead ${lead.id}`);
        return updated;
      }
      logger.warn(`Backfill: no Bitrix24 lead found for phone="${phone}", agent=${agent.bitrixUserId}`);
    } catch (err: any) {
      logger.warn(`Backfill failed for lead ${lead.id}: ${err.message}`);
    }
    return null;
  }

  // ─── Transcribe Voice Message ─────────────────────────────────────────────

  private async transcribeAudio(fileUrl: string, fileName = 'audio.ogg', contentType = 'audio/ogg'): Promise<string | null> {
    try {
      const token = await this.getToken();

      // Download audio from ChatApp CDN
      const audioRes = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${token}` },
      });

      const audioBuffer = Buffer.from(audioRes.data);

      // Send to OpenAI Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: await toFile(audioBuffer, fileName, { type: contentType }),
        model: config.openai.whisperModel,
      });

      return transcription.text || null;
    } catch (err: any) {
      logger.error(`Audio transcription failed for ${fileUrl}: ${err.message}`);
      return null;
    }
  }

  // ─── Extract Message Content ──────────────────────────────────────────────

  private async extractContent(msg: any): Promise<{ content: string; dbType: string; audioUrl?: string }> {
    const msgType: string = msg.type || 'text';

    switch (msgType) {
      case 'text':
        return { content: msg.message?.text || '', dbType: 'whatsapp' };

      case 'audio':
      case 'voice':
      case 'ptt': {
        const fileUrl = msg.message?.file?.link || msg.message?.file?.url;
        if (!fileUrl) return { content: '[Voice message]', dbType: 'voice_transcription' };
        const fileName = msg.message?.file?.name || 'audio.ogg';
        const contentType = msg.message?.file?.contentType || 'audio/ogg';
        const transcribed = await this.transcribeAudio(fileUrl, fileName, contentType);
        if (transcribed === null) {
          // Transcription failed — return placeholder and preserve URL for retry
          return { content: '[Voice message — transcription failed]', dbType: 'voice_transcription', audioUrl: fileUrl };
        }
        return { content: transcribed, dbType: 'voice_transcription' };
      }

      case 'image':
        return { content: msg.message?.caption || '[Image received]', dbType: 'whatsapp' };

      case 'document':
        return {
          content: msg.message?.caption || `[Document: ${msg.message?.file?.name || 'file'}]`,
          dbType: 'whatsapp',
        };

      default:
        return { content: msg.message?.text || msg.message?.caption || `[${msgType}]`, dbType: 'whatsapp' };
    }
  }

  // ─── Main Webhook Handler ─────────────────────────────────────────────────

  async processWebhookMessage(payload: any): Promise<void> {
    const messages: any[] = payload.data || [];
    const meta = payload.meta || {};

    // Log raw webhook
    const webhookLog = await prisma.webhookLog.create({
      data: { source: 'chatapp', eventType: meta.type || 'message', payload, processed: false },
    });

    let allProcessed = true;

    for (const msg of messages) {
      try {
        const messageId: string = msg.id;
        const chatId: string = msg.chat?.id;
        const phone: string = msg.chat?.phone;
        const responsibleId: string = String(msg.chat?.responsible?.id);
        const fromMe: boolean = msg.fromMe;
        const messageTime = msg.time ? new Date(msg.time * 1000) : new Date();

        // Skip duplicates
        const exists = await prisma.message.findFirst({ where: { chatappMessageId: messageId } });
        if (exists) continue;

        // Resolve agent
        const agent = await this.resolveAgent(responsibleId);
        if (!agent) {
          continue;
        }

        // Resolve lead — skip if not in Bitrix24 CRM
        const lead = await this.resolveLead(chatId, phone, agent);
        if (!lead) {
          continue;
        }

        // Extract content (audioUrl set when voice transcription failed — saved for retry)
        const { content, dbType, audioUrl: voiceAudioUrl } = await this.extractContent(msg);
        if (!content.trim()) continue;

        // Build metadata — include audioUrl so retry scheduler can re-attempt failed transcriptions
        const msgMetadata: Record<string, any> = {
          chatId,
          phone,
          responsibleId,
          licenseId: meta.licenseId,
          messengerType: meta.messengerType,
          originalType: msg.type,
          direction: fromMe ? 'outbound' : 'inbound',
        };
        if (voiceAudioUrl) msgMetadata.audioUrl = voiceAudioUrl;

        // Save message
        const message = await prisma.message.create({
          data: {
            leadId: lead.id,
            agentId: agent.id,
            content,
            type: dbType,
            source: 'chatapp',
            direction: fromMe ? 'outbound' : 'inbound',
            chatappMessageId: messageId,
            metadata: msgMetadata,
            createdAt: messageTime,
          },
        });

        // Only embed if transcription succeeded (voiceAudioUrl present means transcription failed)
        if (!voiceAudioUrl) {
          const embedding = await embeddingService.generateEmbedding(content);
          const vectorId = uuidv4();

          await qdrantService.upsertVector({
            id: vectorId,
            vector: embedding,
            payload: {
              agent_id: agent.id,
              lead_id: lead.id,
              message_id: message.id,
              type: dbType,
              content,
              timestamp: messageTime.toISOString(),
              metadata: {
                source: 'chatapp',
                direction: fromMe ? 'outbound' : 'inbound',
                phone,
                chatId,
              },
            },
          });

          await prisma.message.update({
            where: { id: message.id },
            data: { isEmbedded: true, embeddingId: vectorId },
          });
        } else {
          logger.warn(`Voice transcription failed for message ${messageId} — saved with audioUrl for retry`);
        }

        logger.info(`ChatApp message saved: ${messageId} | lead=${lead.id} | agent=${agent.id} | type=${dbType}`);
      } catch (err: any) {
        logger.error(`Error processing ChatApp message ${msg?.id}: ${err.message}`);
        allProcessed = false;
      }
    }

    await prisma.webhookLog.update({
      where: { id: webhookLog.id },
      data: { processed: allProcessed },
    });
  }

  // ─── Retry Failed Voice Transcriptions ───────────────────────────────────
  // Called by scheduler for voice messages where transcription previously failed.
  // Looks for messages with audioUrl in metadata (set on failure) and isEmbedded=false.

  async retryVoiceTranscriptions(lookbackHours: number): Promise<{ retried: number; succeeded: number; failed: number }> {
    const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    const candidates = await prisma.message.findMany({
      where: {
        type: 'voice_transcription',
        isEmbedded: false,
        createdAt: { gte: cutoff },
      },
    });

    // Only retry those with a saved audioUrl (transcription-failed records)
    const toRetry = candidates.filter(
      (m) => m.metadata && typeof m.metadata === 'object' && (m.metadata as any).audioUrl,
    );

    if (toRetry.length === 0) return { retried: 0, succeeded: 0, failed: 0 };

    logger.info(`Voice transcription retry: ${toRetry.length} candidate(s)`);

    let succeeded = 0;
    let failed = 0;

    for (const message of toRetry) {
      const meta = message.metadata as Record<string, any>;
      const audioUrl: string = meta.audioUrl;
      try {
        const transcribed = await this.transcribeAudio(audioUrl);
        if (!transcribed) {
          logger.warn(`Retry still failed for voice message ${message.id}`);
          failed++;
          continue;
        }

        // Update message content and clear the audioUrl so we don't retry again
        const { audioUrl: _removed, ...metaWithoutUrl } = meta;
        await prisma.message.update({
          where: { id: message.id },
          data: { content: transcribed, metadata: metaWithoutUrl },
        });

        // Embed in Qdrant
        const embedding = await embeddingService.generateEmbedding(transcribed);
        const vectorId = uuidv4();

        await qdrantService.upsertVector({
          id: vectorId,
          vector: embedding,
          payload: {
            agent_id: message.agentId,
            lead_id: message.leadId,
            message_id: message.id,
            type: 'voice_transcription',
            content: transcribed,
            timestamp: message.createdAt.toISOString(),
            metadata: {
              source: 'chatapp',
              direction: meta.direction || 'inbound',
              phone: meta.phone,
              chatId: meta.chatId,
            },
          },
        });

        await prisma.message.update({
          where: { id: message.id },
          data: { isEmbedded: true, embeddingId: vectorId },
        });

        logger.info(`Retry voice transcription succeeded for message ${message.id}`);
        succeeded++;
      } catch (err: any) {
        logger.error(`Retry voice transcription error for message ${message.id}: ${err.message}`);
        failed++;
      }
    }

    return { retried: toRetry.length, succeeded, failed };
  }
}

export const chatappService = new ChatAppService();
