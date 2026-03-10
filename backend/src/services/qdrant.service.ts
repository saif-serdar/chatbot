import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config';
import { logger } from '../utils/logger';

class QdrantService {
  private client: QdrantClient;
  private collectionName: string;

  constructor() {
    this.client = new QdrantClient({
      url: `http://${config.qdrant.host}:${config.qdrant.port}`,
    });
    this.collectionName = config.qdrant.collectionName;
  }

  async initialize() {
    try {
      // Check if collection exists
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (col) => col.name === this.collectionName
      );

      if (!exists) {
        // Create collection with proper vector configuration
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: config.openai.embeddingDimensions,
            distance: 'Cosine',
          },
        });

        // Create payload index for filtering
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'agent_id',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'lead_id',
          field_schema: 'keyword',
        });

        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'type',
          field_schema: 'keyword',
        });

        logger.info(`Created Qdrant collection: ${this.collectionName}`);
      } else {
        logger.info(`Qdrant collection already exists: ${this.collectionName}`);
      }
    } catch (error) {
      logger.error('Failed to initialize Qdrant collection:', error);
      throw error;
    }
  }

  async upsertVector(params: {
    id: string;
    vector: number[];
    payload: {
      agent_id: string;
      lead_id?: string;
      message_id?: string;
      type: string;
      content: string;
      timestamp: string;
      metadata?: any;
    };
  }) {
    try {
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: [
          {
            id: params.id,
            vector: params.vector,
            payload: params.payload,
          },
        ],
      });

      logger.debug(`Upserted vector: ${params.id}`);
    } catch (error) {
      logger.error('Failed to upsert vector:', error);
      throw error;
    }
  }

  async search(params: {
    vector: number[];
    agentId?: string;
    leadId?: string;
    type?: string;
    limit?: number;
    isSuperAdmin?: boolean;
  }) {
    try {
      const filter: any = {
        must: [],
      };

      // Only filter by agent_id if NOT super admin
      if (params.agentId && !params.isSuperAdmin) {
        filter.must.push({
          key: 'agent_id',
          match: { value: params.agentId },
        });
      }

      if (params.leadId) {
        filter.must.push({
          key: 'lead_id',
          match: { value: params.leadId },
        });
      }

      if (params.type) {
        filter.must.push({
          key: 'type',
          match: { value: params.type },
        });
      }

      const results = await this.client.search(this.collectionName, {
        vector: params.vector,
        filter,
        limit: params.limit || 10,
        with_payload: true,
      });

      // Log search results with scores
      logger.info(`Qdrant search returned ${results.length} results for agent ${params.agentId}${params.leadId ? `, lead ${params.leadId}` : ''}`);
      results.forEach((result, index) => {
        logger.debug(`  [${index + 1}] Score: ${result.score.toFixed(4)}, Content: "${result.payload?.content?.toString().substring(0, 100)}..."`);
      });

      return results;
    } catch (error) {
      logger.error('Failed to search vectors:', error);
      throw error;
    }
  }

  async deleteVector(id: string) {
    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        points: [id],
      });

      logger.debug(`Deleted vector: ${id}`);
    } catch (error) {
      logger.error('Failed to delete vector:', error);
      throw error;
    }
  }

  async deleteByFilter(agentId: string, leadId?: string) {
    try {
      const filter: any = {
        must: [
          {
            key: 'agent_id',
            match: { value: agentId },
          },
        ],
      };

      if (leadId) {
        filter.must.push({
          key: 'lead_id',
          match: { value: leadId },
        });
      }

      await this.client.delete(this.collectionName, {
        wait: true,
        filter,
      });

      logger.debug(`Deleted vectors for agent: ${agentId}, lead: ${leadId || 'all'}`);
    } catch (error) {
      logger.error('Failed to delete vectors by filter:', error);
      throw error;
    }
  }
}

export const qdrantService = new QdrantService();
