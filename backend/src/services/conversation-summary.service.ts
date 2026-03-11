import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

// Dubai is always UTC+4 (no daylight saving)
const fmtDubai = (d: Date) => {
  const dubai = new Date(d.getTime() + 4 * 60 * 60 * 1000);
  return dubai.toISOString().replace('T', ' ').substring(0, 16) + ' GST';
};

class ConversationSummaryService {

  // ─── Main entry: called by the scheduler ─────────────────────────────────

  async generateWindowSummaries(): Promise<{ processed: number; skipped: number; failed: number }> {
    const lookbackHours = config.conversationSummary.lookbackHours;
    const now = new Date();
    const fallbackStart = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

    // Find all leads that have messages within the lookback window
    const recentLeads = await prisma.message.findMany({
      where: {
        createdAt: { gte: fallbackStart },
        type: { not: 'system' },
      },
      select: { leadId: true },
      distinct: ['leadId'],
    });

    const leadIds = recentLeads.map(r => r.leadId);

    if (leadIds.length === 0) {
      logger.info('Conversation summary: no leads with recent activity');
      return { processed: 0, skipped: 0, failed: 0 };
    }

    logger.info(`Conversation summary: checking ${leadIds.length} lead(s)`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const leadId of leadIds) {
      try {
        const result = await this.processLead(leadId, fallbackStart, now);
        if (result === 'processed') processed++;
        else skipped++;
      } catch (err: any) {
        logger.error(`Conversation summary failed for lead ${leadId}: ${err.message}`);
        failed++;
      }
    }

    logger.info(`Conversation summary done — processed=${processed}, skipped=${skipped}, failed=${failed}`);
    return { processed, skipped, failed };
  }

  // ─── Process one lead ─────────────────────────────────────────────────────

  private async processLead(
    leadId: string,
    fallbackStart: Date,
    windowEnd: Date,
  ): Promise<'processed' | 'skipped'> {
    // Start from the end of the last summary; first time use lookback window
    const lastSummary = await prisma.conversationSummary.findFirst({
      where: { leadId },
      orderBy: { windowEnd: 'desc' },
    });

    const windowStart = lastSummary ? lastSummary.windowEnd : fallbackStart;

    // Fetch all new messages in the window (WhatsApp + call transcripts)
    const messages = await prisma.message.findMany({
      where: {
        leadId,
        createdAt: { gt: windowStart, lte: windowEnd },
        type: { not: 'system' },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (messages.length === 0) return 'skipped';

    // Build chronological combined text
    const lines = messages.map(msg => {
      const time = fmtDubai(msg.createdAt);
      if (msg.type === 'call_transcript') {
        const truncated = msg.content.length > 800
          ? msg.content.substring(0, 800) + '...'
          : msg.content;
        return `[${time}] [Call]: ${truncated}`;
      }
      const role = msg.direction === 'inbound' ? 'Client' : 'Agent';
      return `[${time}] [${role} via WhatsApp]: ${msg.content.substring(0, 500)}`;
    });

    const combinedText = lines.join('\n\n');

    // Generate summary + sentiment via Claude
    const { summary, sentiment } = await this.generateInsights(combinedText);
    if (!summary) {
      logger.warn(`No summary generated for lead ${leadId}, skipping`);
      return 'skipped';
    }

    // Save to conversation_summaries table
    const summaryRecord = await prisma.conversationSummary.create({
      data: {
        leadId,
        windowStart,
        windowEnd,
        summary,
        sentiment: sentiment || 'neutral',
        messageCount: messages.length,
        sources: { messageIds: messages.map(m => m.id) },
      },
    });

    logger.info(`Conversation summary saved — lead=${leadId}, messages=${messages.length}, sentiment=${sentiment}`);

    // Post to Bitrix24 timeline
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (lead?.bitrixLeadId) {
      await this.postToBitrix24(lead.bitrixLeadId, windowStart, windowEnd, summary, sentiment, summaryRecord.id);
    }

    return 'processed';
  }

  // ─── Generate summary + sentiment via Claude Haiku ────────────────────────

  private async generateInsights(
    combinedText: string,
  ): Promise<{ summary: string | null; sentiment: string | null }> {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content:
              `Analyze this conversation between a sales agent and a client. ` +
              `It may include WhatsApp messages and/or call transcripts. ` +
              `Respond with ONLY a JSON object (no markdown, no extra text):\n\n` +
              `{"summary":"2-4 sentence summary of key points discussed and any outcomes or next steps","sentiment":"positive|negative|neutral"}\n\n` +
              `Conversation:\n${combinedText}`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in Claude response');

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : null,
        sentiment: ['positive', 'negative', 'neutral'].includes(parsed.sentiment)
          ? parsed.sentiment
          : 'neutral',
      };
    } catch (err: any) {
      logger.warn(`Conversation insights generation failed: ${err.message}`);
      return { summary: null, sentiment: null };
    }
  }

  // ─── Post summary to Bitrix24 lead timeline ───────────────────────────────

  private async postToBitrix24(
    bitrixLeadId: string,
    windowStart: Date,
    windowEnd: Date,
    summary: string,
    sentiment: string | null,
    summaryId: string,
  ): Promise<void> {
    try {
      let comment = `Conversation Summary (${fmtDubai(windowStart)} → ${fmtDubai(windowEnd)})\n\n`;
      comment += `Summary:\n${summary}`;
      if (sentiment) comment += `\n\nSentiment: ${sentiment}`;

      const url = `${config.bitrix24.webhookUrl}crm.timeline.comment.add.json`;
      const response = await axios.post(url, {
        fields: {
          ENTITY_ID: bitrixLeadId,
          ENTITY_TYPE: 'LEAD',
          COMMENT: comment,
        },
      });

      if (response.data.error) {
        logger.warn(`Bitrix24 timeline error for lead ${bitrixLeadId}: ${response.data.error_description}`);
        return;
      }

      const commentId = String(response.data.result || '');
      logger.info(`Conversation summary posted to Bitrix24 (commentId=${commentId}) for lead ${bitrixLeadId}`);

      await prisma.conversationSummary.update({
        where: { id: summaryId },
        data: { bitrixCommentId: commentId },
      });
    } catch (err: any) {
      logger.warn(`Failed to post conversation summary to Bitrix24: ${err.message}`);
    }
  }
}

export const conversationSummaryService = new ConversationSummaryService();
