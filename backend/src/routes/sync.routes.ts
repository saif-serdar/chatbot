import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { bitrix24SyncService } from '../services/bitrix-sync.service';
import { logger } from '../utils/logger';

const router = Router();

// All sync routes require authentication
router.use(authenticate);

/**
 * POST /api/sync/bitrix24
 * Manually trigger Bitrix24 sync for the authenticated agent
 */
router.post('/bitrix24', async (req: AuthRequest, res: Response) => {
  try {
    const agentId = req.user!.id;
    const { hoursLookback } = req.body;

    logger.info(`Manual Bitrix24 sync triggered by agent ${agentId}`);

    const result = await bitrix24SyncService.syncAllLeads(
      agentId,
      hoursLookback || 2 // Default: last 2 hours
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    logger.error('Manual Bitrix24 sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/sync/bitrix24/lead/:leadId
 * Manually sync a specific lead
 */
router.post('/bitrix24/lead/:leadBitrixId', async (req: AuthRequest, res: Response) => {
  try {
    const agentId = req.user!.id;
    const { leadBitrixId } = req.params;
    const { hoursLookback } = req.body;

    logger.info(`Manual sync for lead ${leadBitrixId} by agent ${agentId}`);

    const result = await bitrix24SyncService.syncLead(
      leadBitrixId,
      agentId,
      hoursLookback || 2
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    logger.error(`Manual sync for lead error:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
