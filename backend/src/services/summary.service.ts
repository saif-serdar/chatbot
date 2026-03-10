import { claudeService } from './claude.service';
import { embeddingService } from './embedding.service';
import { qdrantService } from './qdrant.service';
import { logger } from '../utils/logger';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';

class SummaryService {
  /**
   * Generate summary for inactive sessions
   * Called by cron job every 30 minutes (or configured interval)
   */
  async summarizeInactiveSessions() {
    try {
      const inactivityThreshold = new Date(
        Date.now() - config.sessionSummary.inactivityHours * 60 * 60 * 1000
      );

      // Find sessions that are:
      // 1. Active (not yet marked as ended)
      // 2. Not yet summarized
      // 3. Last activity was more than X hours ago
      // 4. Has minimum number of messages
      const inactiveSessions = await prisma.chatSession.findMany({
        where: {
          isActive: true,
          isSummarized: false,
          lastActivityAt: {
            lt: inactivityThreshold
          }
        },
        include: {
          chatMessages: true,
          lead: true
        }
      });

      logger.info(`Found ${inactiveSessions.length} inactive sessions to summarize`);

      let summarized = 0;
      let skipped = 0;
      let failed = 0;

      for (const session of inactiveSessions) {
        try {
          // Skip if too few messages
          if (session.chatMessages.length < config.sessionSummary.minMessages) {
            logger.info(`Skipping session ${session.id} - only ${session.chatMessages.length} messages`);
            skipped++;
            continue;
          }

          await this.generateSessionSummary(session.id);
          summarized++;
        } catch (error) {
          logger.error(`Failed to summarize session ${session.id}:`, error);
          failed++;
        }
      }

      logger.info(`Summarization complete: ${summarized} summarized, ${skipped} skipped, ${failed} failed`);

      return {
        total: inactiveSessions.length,
        summarized,
        skipped,
        failed
      };
    } catch (error) {
      logger.error('Error in summarizeInactiveSessions:', error);
      throw error;
    }
  }

  /**
   * Generate summary for a specific session
   */
  async generateSessionSummary(sessionId: string) {
    try {
      // Get session with all messages and lead info
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: {
          chatMessages: {
            orderBy: { createdAt: 'asc' }
          },
          lead: true,
          agent: true
        }
      });

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.chatMessages.length === 0) {
        logger.info(`Session ${sessionId} has no messages, skipping`);
        return null;
      }

      // Build conversation text
      const conversationText = session.chatMessages
        .map(msg => `${msg.role === 'user' ? 'Agent' : 'AI'}: ${msg.content}`)
        .join('\n\n');

      // Create summary prompt
      const summaryPrompt = `You are analyzing a conversation between a sales agent and an AI assistant about a lead.

Lead: ${session.lead?.name || 'Unknown'}
Lead Phone: ${session.lead?.phone || 'N/A'}
Lead Email: ${session.lead?.email || 'N/A'}
Conversation Date: ${session.createdAt.toISOString().split('T')[0]}
Number of messages: ${session.chatMessages.length}

Full Conversation:
${conversationText}

Please provide a concise but comprehensive summary (2-3 paragraphs) that captures:

1. **Key Facts Discovered**: Budget, timeline, requirements, concerns, preferences
2. **Important Insights**: Patterns, priorities, decision factors, objections
3. **Action Items**: Next steps mentioned, follow-ups needed, commitments made
4. **Context**: Any important background or situational details

Focus on information that would be valuable for future conversations with this lead. Be specific with numbers, dates, and names when mentioned.

Summary:`;

      logger.info(`Generating summary for session ${sessionId}...`);

      // Generate summary using Claude
      const summary = await claudeService.generateText(summaryPrompt);

      logger.info(`Summary generated for session ${sessionId}`);

      // Only embed if lead exists (lead-specific conversations)
      let vectorId: string | null = null;

      if (session.leadId) {
        // Generate embedding for the summary
        const embedding = await embeddingService.generateEmbedding(summary);

        // Store in Qdrant
        vectorId = uuidv4();
        await qdrantService.upsertVector({
          id: vectorId,
          vector: embedding,
          payload: {
            agent_id: session.agentId,
            lead_id: session.leadId,
            type: 'session_summary',
            content: summary,
            timestamp: new Date().toISOString(),
            metadata: {
              source: 'agent_chat_summary',
              priority: 2,
              session_id: sessionId,
              message_count: session.chatMessages.length,
              session_duration_minutes: Math.floor(
                (session.lastActivityAt.getTime() - session.createdAt.getTime()) / 60000
              ),
              lead_name: session.lead?.name || 'Unknown'
            }
          }
        });

        logger.info(`Summary embedded in Qdrant for session ${sessionId}`);
      }

      // Update session with summary
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          summary: summary,
          isSummarized: true,
          summaryEmbeddingId: vectorId,
          isActive: false // Mark session as ended
        }
      });

      logger.info(`Session ${sessionId} marked as summarized`);

      return summary;
    } catch (error) {
      logger.error(`Error generating summary for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup old messages after retention period
   * Keeps summaries but deletes individual messages
   */
  async cleanupOldMessages() {
    try {
      if (!config.sessionSummary.cleanupEnabled) {
        logger.info('Message cleanup is disabled');
        return { deleted: 0 };
      }

      const cutoffDate = new Date(
        Date.now() - config.sessionSummary.cleanupAfterDays * 24 * 60 * 60 * 1000
      );

      // Find sessions that:
      // 1. Have been summarized
      // 2. Summary was created more than X days ago
      const sessionsToCleanup = await prisma.chatSession.findMany({
        where: {
          isSummarized: true,
          updatedAt: {
            lt: cutoffDate
          }
        },
        select: {
          id: true,
          updatedAt: true
        }
      });

      logger.info(`Found ${sessionsToCleanup.length} sessions with messages to cleanup`);

      let totalDeleted = 0;

      for (const session of sessionsToCleanup) {
        try {
          // Delete all chat messages for this session
          const result = await prisma.chatMessage.deleteMany({
            where: {
              sessionId: session.id
            }
          });

          totalDeleted += result.count;

          logger.info(
            `Deleted ${result.count} messages from session ${session.id} (summary created ${session.updatedAt.toISOString()})`
          );
        } catch (error) {
          logger.error(`Failed to cleanup session ${session.id}:`, error);
        }
      }

      logger.info(`Cleanup complete: Deleted ${totalDeleted} messages from ${sessionsToCleanup.length} sessions`);

      return {
        sessionsProcessed: sessionsToCleanup.length,
        messagesDeleted: totalDeleted
      };
    } catch (error) {
      logger.error('Error in cleanupOldMessages:', error);
      throw error;
    }
  }

  /**
   * Get summary statistics
   */
  async getSummaryStats() {
    try {
      const [total, summarized, pending, cleaned] = await Promise.all([
        prisma.chatSession.count(),
        prisma.chatSession.count({ where: { isSummarized: true } }),
        prisma.chatSession.count({
          where: {
            isActive: true,
            isSummarized: false,
            lastActivityAt: {
              lt: new Date(Date.now() - config.sessionSummary.inactivityHours * 60 * 60 * 1000)
            }
          }
        }),
        prisma.chatSession.count({
          where: {
            isSummarized: true,
            chatMessages: {
              none: {} // Sessions with no messages (cleaned up)
            }
          }
        })
      ]);

      return {
        totalSessions: total,
        summarizedSessions: summarized,
        pendingSummarization: pending,
        cleanedSessions: cleaned,
        summarizationRate: total > 0 ? ((summarized / total) * 100).toFixed(2) + '%' : '0%'
      };
    } catch (error) {
      logger.error('Error getting summary stats:', error);
      throw error;
    }
  }
}

export const summaryService = new SummaryService();
