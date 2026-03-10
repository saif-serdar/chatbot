import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { qdrantService } from '../services/qdrant.service';
import { embeddingService } from '../services/embedding.service';
import { prisma } from '../lib/prisma';

/**
 * MCP Server for Lead History Access
 * Provides tools to search and retrieve lead conversation history
 */
class LeadHistoryServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'lead-history-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_lead_history',
            description: 'Search conversation history for a specific lead using semantic search',
            inputSchema: {
              type: 'object',
              properties: {
                agent_id: {
                  type: 'string',
                  description: 'The ID of the agent requesting the search',
                },
                lead_id: {
                  type: 'string',
                  description: 'The ID of the lead to search history for',
                },
                query: {
                  type: 'string',
                  description: 'The search query',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 10)',
                },
              },
              required: ['agent_id', 'lead_id', 'query'],
            },
          },
          {
            name: 'get_lead_messages',
            description: 'Get recent messages for a lead in chronological order',
            inputSchema: {
              type: 'object',
              properties: {
                agent_id: {
                  type: 'string',
                  description: 'The ID of the agent requesting the messages',
                },
                lead_id: {
                  type: 'string',
                  description: 'The ID of the lead',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of messages to return (default: 20)',
                },
              },
              required: ['agent_id', 'lead_id'],
            },
          },
          {
            name: 'get_lead_info',
            description: 'Get basic information about a lead',
            inputSchema: {
              type: 'object',
              properties: {
                agent_id: {
                  type: 'string',
                  description: 'The ID of the agent requesting the info',
                },
                lead_id: {
                  type: 'string',
                  description: 'The ID of the lead',
                },
              },
              required: ['agent_id', 'lead_id'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'search_lead_history':
          return await this.searchLeadHistory(args);

        case 'get_lead_messages':
          return await this.getLeadMessages(args);

        case 'get_lead_info':
          return await this.getLeadInfo(args);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async searchLeadHistory(args: any) {
    const { agent_id, lead_id, query, limit = 10 } = args;

    // Verify access
    const lead = await prisma.lead.findFirst({
      where: {
        id: lead_id,
        agentId: agent_id,
      },
    });

    if (!lead) {
      return {
        content: [
          {
            type: 'text',
            text: 'Lead not found or access denied',
          },
        ],
      };
    }

    // Generate embedding for query
    const queryEmbedding = await embeddingService.generateEmbedding(query);

    // Search in Qdrant
    const results = await qdrantService.search({
      vector: queryEmbedding,
      agentId: agent_id,
      leadId: lead_id,
      limit,
    });

    const formattedResults = results.map((result) => ({
      content: result.payload?.content,
      type: result.payload?.type,
      timestamp: result.payload?.timestamp,
      score: result.score,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(formattedResults, null, 2),
        },
      ],
    };
  }

  private async getLeadMessages(args: any) {
    const { agent_id, lead_id, limit = 20 } = args;

    // Verify access
    const lead = await prisma.lead.findFirst({
      where: {
        id: lead_id,
        agentId: agent_id,
      },
    });

    if (!lead) {
      return {
        content: [
          {
            type: 'text',
            text: 'Lead not found or access denied',
          },
        ],
      };
    }

    const messages = await prisma.message.findMany({
      where: {
        leadId: lead_id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(messages.reverse(), null, 2),
        },
      ],
    };
  }

  private async getLeadInfo(args: any) {
    const { agent_id, lead_id } = args;

    const lead = await prisma.lead.findFirst({
      where: {
        id: lead_id,
        agentId: agent_id,
      },
    });

    if (!lead) {
      return {
        content: [
          {
            type: 'text',
            text: 'Lead not found or access denied',
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(lead, null, 2),
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Lead History MCP Server running on stdio');
  }
}

// Start the server
const server = new LeadHistoryServer();
server.run().catch(console.error);
