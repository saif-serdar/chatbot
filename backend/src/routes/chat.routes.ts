import { Router, Response } from 'express';
import { chatService } from '../services/chat.service';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// All chat routes require authentication
router.use(authenticate);

// Smart chat - automatically finds lead from question
router.post('/smart', async (req: AuthRequest, res: Response) => {
  try {
    const { message, sessionId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const result = await chatService.smartChat({
      agentId: req.user!.id,
      message,
      sessionId,
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Smart chat error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Send a chat message (legacy - with leadId)
router.post('/message', async (req: AuthRequest, res: Response) => {
  try {
    const { leadId, message, sessionId } = req.body;

    if (!leadId || !message) {
      return res.status(400).json({ error: 'Lead ID and message are required' });
    }

    const result = await chatService.sendMessage({
      agentId: req.user!.id,
      leadId,
      message,
      sessionId,
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Send message error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Get chat history for a session
router.get('/session/:sessionId', async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.params;

    const session = await chatService.getChatHistory(sessionId, req.user!.id);

    res.json(session);
  } catch (error: any) {
    logger.error('Get chat history error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Get all sessions for the agent
router.get('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const { leadId } = req.query;

    const sessions = await chatService.getSessions(
      req.user!.id,
      leadId as string | undefined
    );

    res.json(sessions);
  } catch (error: any) {
    logger.error('Get sessions error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

export default router;
