import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';

class EmbeddingService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: config.openai.embeddingModel,
        input: text,
        encoding_format: 'float',
      });

      return response.data[0].embedding;
    } catch (error) {
      logger.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: config.openai.embeddingModel,
        input: texts,
        encoding_format: 'float',
      });

      return response.data.map((item) => item.embedding);
    } catch (error) {
      logger.error('Failed to generate embeddings:', error);
      throw error;
    }
  }
}

export const embeddingService = new EmbeddingService();
