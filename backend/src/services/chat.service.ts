import { qdrantService } from './qdrant.service';
import { embeddingService } from './embedding.service';
import { claudeService } from './claude.service';
import { leadSearchService } from './lead-search.service';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

class ChatService {
  /**
   * Smart chat - automatically finds lead from query
   */
  async smartChat(params: {
    agentId: string;
    message: string;
    sessionId?: string;
  }) {
    try {
      // Try to find lead from the query
      const searchResult = await leadSearchService.findLeadFromQuery(
        params.agentId,
        params.message
      );

      // If it's a general query (not about a specific lead), respond without lead context
      if (searchResult.isGeneralQuery) {
        const response = await claudeService.chat({
          userMessage: params.message,
          context: {
            messages: [],
            leadInfo: undefined,
          },
          conversationHistory: [],
        });

        return {
          type: 'answer',
          lead: null,
          message: response.message,
          sources: [],
          usage: response.usage,
        };
      }

      // If no lead found after trying to extract, return clarification message
      if (!searchResult.found || !searchResult.lead) {
        return {
          type: 'clarification',
          message: searchResult.message,
          suggestions: searchResult.suggestions || [],
        };
      }

      // Lead found! Proceed with normal chat
      const result = await this.sendMessage({
        agentId: params.agentId,
        leadId: searchResult.lead.id,
        message: params.message,
        sessionId: params.sessionId,
      });

      return {
        type: 'answer',
        lead: searchResult.lead,
        ...result,
      };
    } catch (error) {
      logger.error('Smart chat error:', error);
      throw error;
    }
  }
  async sendMessage(params: {
    agentId: string;
    leadId: string;
    message: string;
    sessionId?: string;
  }) {
    try {
      // Get current agent to check role
      const currentAgent = await prisma.agent.findUnique({
        where: { id: params.agentId }
      });

      if (!currentAgent) {
        throw new AppError('Agent not found', 404);
      }

      const isSuperAdmin = currentAgent.role === 'super_admin' || currentAgent.role === 'admin';

      // Verify agent has access to this lead (skip check for super admin)
      const leadQuery: any = { id: params.leadId };
      if (!isSuperAdmin) {
        leadQuery.agentId = params.agentId;  // Only filter by agentId for regular agents
      }

      const lead = await prisma.lead.findFirst({
        where: leadQuery,
      });

      if (!lead) {
        throw new AppError('Lead not found or access denied', 403);
      }

      // Get or create chat session
      let session;
      if (params.sessionId) {
        const sessionQuery: any = { id: params.sessionId };
        if (!isSuperAdmin) {
          sessionQuery.agentId = params.agentId;  // Only filter by agentId for regular agents
        }

        session = await prisma.chatSession.findFirst({
          where: sessionQuery,
        });

        if (!session) {
          throw new AppError('Session not found', 404);
        }
      } else {
        session = await prisma.chatSession.create({
          data: {
            agentId: params.agentId,
            leadId: params.leadId,
            title: params.message.slice(0, 50) + '...',
          },
        });
      }

      // Generate embedding for the user's query
      const queryEmbedding = await embeddingService.generateEmbedding(params.message);

      // Search for relevant context in Qdrant
      const searchResults = await qdrantService.search({
        vector: queryEmbedding,
        agentId: isSuperAdmin ? undefined : params.agentId,  // Skip agent filter for super admin
        leadId: params.leadId,
        limit: 10,
        isSuperAdmin: isSuperAdmin,
      });

      // Build context from search results
      const contextMessages = searchResults
        .map((result) => ({
          type: result.payload?.type as string,
          content: result.payload?.content as string,
          timestamp: result.payload?.timestamp as string,
          source: result.payload?.metadata?.source || 'unknown',
          score: result.score,
        }))
        // Sort by timestamp (newest first) so recent important messages appear first
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Get conversation history from this session
      const chatHistory = await prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      const conversationHistory = chatHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      // Call Claude with context
      const response = await claudeService.chat({
        userMessage: params.message,
        context: {
          messages: contextMessages,
          leadInfo: {
            name: lead.name,
            phone: lead.phone || undefined,
            email: lead.email || undefined,
            status: lead.status || undefined,
          },
        },
        conversationHistory,
      });

      // Save user message
      await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'user',
          content: params.message,
        },
      });

      // Save assistant response
      await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: 'assistant',
          content: response.message,
          sources: contextMessages.map((msg) => ({
            type: msg.type,
            timestamp: msg.timestamp,
            source: msg.source,
            score: msg.score,
            preview: msg.content.slice(0, 100),
          })),
          tokenCount: response.usage.inputTokens + response.usage.outputTokens,
        },
      });

      // Update session's last activity timestamp
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { lastActivityAt: new Date() }
      });

      return {
        sessionId: session.id,
        message: response.message,
        sources: contextMessages.slice(0, 5).map((msg) => ({
          type: msg.type,
          timestamp: msg.timestamp,
          source: msg.source,
          preview: msg.content.slice(0, 100) + '...',
        })),
        usage: response.usage,
      };
    } catch (error) {
      logger.error('Chat service error:', error);
      throw error;
    }
  }

  async getChatHistory(sessionId: string, agentId: string) {
    try {
      const session = await prisma.chatSession.findFirst({
        where: {
          id: sessionId,
          agentId: agentId,
        },
        include: {
          chatMessages: {
            orderBy: { createdAt: 'asc' },
          },
          lead: true,
        },
      });

      if (!session) {
        throw new AppError('Session not found', 404);
      }

      return session;
    } catch (error) {
      logger.error('Get chat history error:', error);
      throw error;
    }
  }

  async getSessions(agentId: string, leadId?: string) {
    try {
      const sessions = await prisma.chatSession.findMany({
        where: {
          agentId: agentId,
          ...(leadId && { leadId }),
          isActive: true,
        },
        include: {
          lead: true,
          chatMessages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      return sessions;
    } catch (error) {
      logger.error('Get sessions error:', error);
      throw error;
    }
  }
}

export const chatService = new ChatService();
