import { Router, Request, Response } from 'express';
import { webhookService } from '../services/webhook.service';
import { chatappService } from '../services/chatapp.service';
import { logger } from '../utils/logger';

const router = Router();

// ─── ChatApp Webhook ──────────────────────────────────────────────────────────
// ChatApp POSTs every inbound/outbound WhatsApp message here in real-time.

router.post('/chatapp', async (req: Request, res: Response) => {
  // Respond immediately so ChatApp does not retry
  res.json({ success: true });

  // Process asynchronously after responding
  chatappService.processWebhookMessage(req.body).catch((err) => {
    logger.error('ChatApp webhook processing error:', err);
  });
});

// ─── Bitrix24 Activity Webhook (MyHub calls) ──────────────────────────────────
// Triggered by Bitrix24 when a call activity is added or updated.

router.post('/bitrix24/activity', async (req: Request, res: Response) => {
  try {
    // Respond immediately to prevent Bitrix24 timeout/retry
    res.json({ success: true, message: 'Activity webhook received' });

    webhookService.processBitrix24Activity(req.body).catch((err) => {
      logger.error('Error processing Bitrix24 activity webhook:', err);
    });
  } catch (err: any) {
    logger.error('Bitrix24 activity webhook error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

export default router;
