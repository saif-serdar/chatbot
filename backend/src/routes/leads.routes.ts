import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { prisma } from '../lib/prisma';

const router = Router();

// All lead routes require authentication
router.use(authenticate);

// Get all leads for the authenticated agent
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const leads = await prisma.lead.findMany({
      where: {
        agentId: req.user!.id,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    res.json(leads);
  } catch (error: any) {
    logger.error('Get leads error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get a specific lead
router.get('/:leadId', async (req: AuthRequest, res: Response) => {
  try {
    const { leadId } = req.params;

    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        agentId: req.user!.id,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 50,
        },
      },
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json(lead);
  } catch (error: any) {
    logger.error('Get lead error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a lead
router.get('/:leadId/messages', async (req: AuthRequest, res: Response) => {
  try {
    const { leadId } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    // Verify lead belongs to agent
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        agentId: req.user!.id,
      },
    });

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const messages = await prisma.message.findMany({
      where: {
        leadId: leadId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
    });

    res.json(messages);
  } catch (error: any) {
    logger.error('Get lead messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
