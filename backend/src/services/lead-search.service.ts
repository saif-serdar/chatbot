import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../lib/prisma';

interface LeadIdentifier {
  phone?: string;
  email?: string;
  name?: string;
}

class LeadSearchService {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
  }

  /**
   * Extract lead identifiers from natural language query using Claude
   */
  async extractLeadIdentifiers(query: string): Promise<LeadIdentifier> {
    try {
      const prompt = `Extract contact information from this query. Return ONLY a JSON object with extracted fields (phone, email, or name). If nothing is found, return empty object.

Query: "${query}"

Rules:
- Extract phone numbers (with or without country code)
- Extract email addresses
- Extract person names (not generic terms like "customer" or "client" or "lead")
- Look for names after words like "Lead name is", "name is", "called", "named"
- Return format: {"phone": "...", "email": "...", "name": "..."}
- Only include fields you find
- Return ONLY valid JSON, no markdown or explanation

Examples:
"What did +1234567890 say?" → {"phone": "+1234567890"}
"Tell me about john.doe@email.com" → {"email": "john.doe@email.com"}
"What's the status of John Doe?" → {"name": "John Doe"}
"Lead name is x check details" → {"name": "x"}
"Check if Ahmed is interested" → {"name": "Ahmed"}
"Tell me about the lead called Sarah" → {"name": "Sarah"}
"Show me recent messages" → {}`;

      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        logger.debug('Claude response was not text type');
        return {};
      }

      logger.debug('Claude extraction response:', content.text);

      // Parse JSON from Claude's response
      const jsonMatch = content.text.match(/\{[^}]+\}/);
      if (!jsonMatch) {
        logger.warn('No JSON found in Claude response:', content.text);
        return {};
      }

      const extracted = JSON.parse(jsonMatch[0]);
      logger.info('Extracted lead identifiers:', extracted);
      return extracted;
    } catch (error) {
      logger.error('Failed to extract lead identifiers:', error);
      return {};
    }
  }

  /**
   * Search for leads based on extracted identifiers
   */
  async searchLeads(agentId: string, identifiers: LeadIdentifier) {
    try {
      const { phone, email, name } = identifiers;

      // Build search conditions
      const conditions: any[] = [];

      if (phone) {
        // Fuzzy phone search (remove spaces, dashes, etc.)
        const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
        conditions.push({
          phone: {
            contains: cleanPhone,
          },
        });
      }

      if (email) {
        conditions.push({
          email: {
            equals: email,
            mode: 'insensitive',
          },
        });
      }

      if (name) {
        conditions.push({
          name: {
            contains: name,
            mode: 'insensitive',
          },
        });
      }

      // If no identifiers, return empty
      if (conditions.length === 0) {
        return [];
      }

      // Search for leads
      const leads = await prisma.lead.findMany({
        where: {
          agentId: agentId,
          OR: conditions,
        },
        take: 5, // Limit to 5 matches
      });

      logger.info(`Found ${leads.length} leads matching criteria`);
      return leads;
    } catch (error) {
      logger.error('Lead search error:', error);
      throw error;
    }
  }

  /**
   * Check if query is asking about a specific lead OR has lead-related intent
   */
  async  isLeadSpecificQuery(query: string): Promise<boolean> {
    try {
      const prompt = `Is this query asking about a lead/customer/contact from a database? Answer with ONLY "yes" or "no".

Query: "${query}"

Answer "yes" if:
- Query contains a specific phone number, email, or person's name
- Query asks "what did [specific person] say"
- Query asks about conversation history with a named person
- Query asks for lead details/information (even without specifics)
- Query wants to see/show/get/find leads
- Example: "What did +1234567890 say?" → yes
- Example: "Tell me about John Doe" → yes
- Example: "What did Saif say?" → yes
- Example: "Give me detail of lead" → yes
- Example: "Show me lead information" → yes
- Example: "Find a lead" → yes
- Example: "I want to see lead details" → yes

Answer "no" if:
- General greeting or casual conversation
- Asking about the user's own role/identity
- General business questions not about leads
- Questions about generic "client" or "agent" without context of database lookup
- Example: "Hi" → no
- Example: "How are you?" → no
- Example: "Am I a client or agent?" → no
- Example: "Who are you?" → no
- Example: "What can you do?" → no

Answer:`;

      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return false;
      }

      const answer = content.text.trim().toLowerCase();
      return answer === 'yes';
    } catch (error) {
      logger.error('Failed to check if query is lead-specific:', error);
      // Default to false - treat as general query if uncertain
      return false;
    }
  }

  /**
   * Smart lead search from natural language query
   */
  async findLeadFromQuery(agentId: string, query: string) {
    try {
      // First, check if this query is actually about a specific lead
      const isLeadQuery = await this.isLeadSpecificQuery(query);

      // If not asking about a lead, return null (will be handled as general chat)
      if (!isLeadQuery) {
        return {
          found: false,
          lead: null,
          message: null, // null means "handle as general conversation"
          isGeneralQuery: true,
        };
      }

      // Extract identifiers from query
      const identifiers = await this.extractLeadIdentifiers(query);

      // If no identifiers found, ask for clarification
      if (Object.keys(identifiers).length === 0) {
        return {
          found: false,
          lead: null,
          message: 'I see you want lead details. Can you tell me which lead? (name, phone, or email)',
          isGeneralQuery: false,
        };
      }

      // Search for leads
      const leads = await this.searchLeads(agentId, identifiers);

      // Handle results
      if (leads.length === 0) {
        return {
          found: false,
          lead: null,
          message: `No leads found matching ${JSON.stringify(identifiers)}. Please check the details.`,
          isGeneralQuery: false,
        };
      }

      if (leads.length === 1) {
        return {
          found: true,
          lead: leads[0],
          message: null,
          isGeneralQuery: false,
        };
      }

      // Multiple matches
      return {
        found: false,
        lead: null,
        message: `Found ${leads.length} leads matching your query. Please be more specific:\n${leads
          .map((l) => `- ${l.name} (${l.phone || l.email})`)
          .join('\n')}`,
        suggestions: leads,
        isGeneralQuery: false,
      };
    } catch (error) {
      logger.error('Find lead from query error:', error);
      throw error;
    }
  }
}

export const leadSearchService = new LeadSearchService();
