import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { logger } from '../utils/logger';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatContext {
  messages: Array<{
    type: string;
    content: string;
    timestamp: string;
    source: string;
  }>;
  leadInfo?: {
    name: string;
    phone?: string;
    email?: string;
    status?: string;
  };
}

class ClaudeService {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
  }

  async chat(params: {
    userMessage: string;
    context: ChatContext;
    conversationHistory?: ChatMessage[];
  }) {
    try {
      const systemPrompt = this.buildSystemPrompt(params.context);

      const messages: Anthropic.MessageParam[] = [
        ...(params.conversationHistory || []).map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
        {
          role: 'user' as const,
          content: params.userMessage,
        },
      ];

      const response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        system: systemPrompt,
        messages,
      });

      const assistantMessage = response.content[0];

      if (assistantMessage.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      return {
        message: assistantMessage.text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      logger.error('Claude API error:', error);
      throw error;
    }
  }

  /**
   * Simple text generation (for summaries, etc.)
   */
  async generateText(prompt: string) {
    try {
      const response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];

      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      return content.text;
    } catch (error) {
      logger.error('Claude generateText error:', error);
      throw error;
    }
  }

  private buildSystemPrompt(context: ChatContext): string {
    const { messages, leadInfo } = context;

    let prompt = `You are a helpful AI assistant for a Bitrix24 CRM agent. Your role is to help agents quickly find information about their leads and conversations.

You have access to the following information about the current lead:`;

    if (leadInfo) {
      prompt += `\n\n**Lead Information:**
- Name: ${leadInfo.name}
- Phone: ${leadInfo.phone || 'N/A'}
- Email: ${leadInfo.email || 'N/A'}
- Status: ${leadInfo.status || 'N/A'}`;
    }

    if (messages && messages.length > 0) {
      prompt += `\n\n**Recent Conversation History (${messages.length} messages):**\n`;

      messages.forEach((msg, index) => {
        const date = new Date(msg.timestamp).toLocaleString();
        prompt += `\n[${date}] ${msg.type.toUpperCase()} (${msg.source}):
${msg.content}\n`;
      });
    }

    prompt += `\n\n**Instructions:**
1. Answer questions based on the information provided above
2. Work with whatever information is available - even short messages like greetings are valuable conversation data
3. If asked about a lead, ALWAYS acknowledge the conversation history that exists, even if it's brief
4. Be helpful and provide context: mention what messages you can see, when they were sent, and what they contain
5. If asked for specific information you don't have, be clear about what you CAN see vs what's missing
6. When referencing conversations, include the date/time
7. Always maintain professional tone

**Example responses:**
- If asked "What did Saif say?" and you see "Hi" and "How are you?", respond: "Based on the conversation history, Saif sent 2 messages: 'Hi' on [date] and 'How are you?' on [date]. These are the most recent messages from this lead."
- Don't say "I don't have information" when you actually have conversation messages - describe what you see

**Important:** You can only see information for this specific lead. You do not have access to information about other leads or agents.`;

    return prompt;
  }

  async streamChat(params: {
    userMessage: string;
    context: ChatContext;
    conversationHistory?: ChatMessage[];
    onChunk: (chunk: string) => void;
  }) {
    try {
      const systemPrompt = this.buildSystemPrompt(params.context);

      const messages: Anthropic.MessageParam[] = [
        ...(params.conversationHistory || []).map((msg) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
        {
          role: 'user' as const,
          content: params.userMessage,
        },
      ];

      const stream = await this.client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        system: systemPrompt,
        messages,
        stream: true,
      });

      let fullMessage = '';
      let usage = { inputTokens: 0, outputTokens: 0 };

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const chunk = event.delta.text;
            fullMessage += chunk;
            params.onChunk(chunk);
          }
        } else if (event.type === 'message_start') {
          usage.inputTokens = event.message.usage.input_tokens;
        } else if (event.type === 'message_delta') {
          usage.outputTokens = event.usage.output_tokens;
        }
      }

      return {
        message: fullMessage,
        usage,
      };
    } catch (error) {
      logger.error('Claude streaming error:', error);
      throw error;
    }
  }
}

export const claudeService = new ClaudeService();
