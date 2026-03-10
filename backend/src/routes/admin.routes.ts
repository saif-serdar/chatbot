import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../lib/prisma';

const router = Router();

// ─── Admin Auth Middleware ────────────────────────────────────────────────────

function adminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'Admin token required' });
  try {
    const payload = jwt.verify(token, config.jwt.secret) as any;
    if (payload.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired admin token' });
  }
}

// ─── Public: Admin Login ─────────────────────────────────────────────────────

/**
 * POST /api/admin/login
 * Super admin login with email + password from env.
 */
router.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (email === config.admin.email && password === config.admin.password) {
    const token = jwt.sign({ role: 'admin' }, config.jwt.secret, { expiresIn: '24h' });
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: 'Invalid credentials' });
});

// ─── All routes below require admin auth ─────────────────────────────────────

router.use(adminAuth);

// ─── Fetch Bitrix24 user name by ID ──────────────────────────────────────────

async function fetchBitrixUser(bitrixUserId: string): Promise<{ name: string; email: string } | null | { error: string }> {
  try {
    const url = `${config.bitrix24.webhookUrl}user.get.json`;
    const response = await axios.post(url, { ID: parseInt(bitrixUserId, 10) });

    if (response.data?.error) {
      const msg = response.data.error_description || response.data.error;
      logger.warn(`Bitrix24 user.get error for ${bitrixUserId}: ${msg}`);
      return { error: msg };
    }

    const user = response.data?.result?.[0];
    if (!user) {
      logger.warn(`Bitrix24 user ${bitrixUserId} not found`);
      return { error: `User ID ${bitrixUserId} not found in Bitrix24` };
    }

    return {
      name: `${user.NAME || ''} ${user.LAST_NAME || ''}`.trim() || user.EMAIL || '',
      email: user.EMAIL || '',
    };
  } catch (err: any) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || err.message;
    logger.warn(`Could not fetch Bitrix24 user ${bitrixUserId}: ${msg}`);
    return { error: msg };
  }
}

// ─── GET /api/admin/agents ────────────────────────────────────────────────────

router.get('/agents', async (_req: Request, res: Response) => {
  try {
    const agents = await prisma.agent.findMany({
      select: { id: true, name: true, email: true, bitrixUserId: true, chatappUserId: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, agents });
  } catch (err: any) {
    logger.error('Failed to fetch agents:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/admin/agents/create ───────────────────────────────────────────

/**
 * Create a new agent by Bitrix24 User ID.
 * Fetches real name + email from Bitrix24 first, then creates in DB.
 */
router.post('/agents/create', async (req: Request, res: Response) => {
  try {
    const { bitrixUserId, password } = req.body;

    if (!bitrixUserId?.toString().trim() || !password?.trim()) {
      return res.status(400).json({ success: false, error: 'Bitrix User ID and password are required' });
    }

    const bitrixId = String(bitrixUserId).trim();

    if (!/^\d+$/.test(bitrixId)) {
      return res.status(400).json({ success: false, error: 'Bitrix User ID must be a number' });
    }

    // Check Bitrix ID not already taken
    const idConflict = await prisma.agent.findFirst({ where: { bitrixUserId: bitrixId } });
    if (idConflict) {
      return res.status(409).json({ success: false, error: `Bitrix User ID ${bitrixId} is already assigned to agent "${idConflict.name}"` });
    }

    // Fetch real name + email from Bitrix24
    const bitrixUser = await fetchBitrixUser(bitrixId);
    if (!bitrixUser) {
      return res.status(502).json({ success: false, error: 'Could not reach Bitrix24' });
    }
    if ('error' in bitrixUser) {
      return res.status(400).json({ success: false, error: `Bitrix24: ${bitrixUser.error}` });
    }

    const { name, email } = bitrixUser;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Bitrix24 returned no name for this user ID' });
    }

    // Check email uniqueness
    if (email) {
      const emailConflict = await prisma.agent.findFirst({ where: { email } });
      if (emailConflict) {
        return res.status(409).json({ success: false, error: `Email ${email} is already used by agent "${emailConflict.name}"` });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const agent = await prisma.agent.create({
      data: {
        name,
        email: email || `bitrix_${bitrixId}@placeholder.local`,
        passwordHash,
        bitrixUserId: bitrixId,
      },
      select: { id: true, name: true, email: true, bitrixUserId: true, chatappUserId: true },
    });

    logger.info(`Admin created agent from Bitrix24: ${agent.name} (${agent.email}), bitrixUserId=${bitrixId}`);
    res.status(201).json({ success: true, agent });
  } catch (err: any) {
    logger.error('Failed to create agent:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/admin/agents/save ─────────────────────────────────────────────

router.post('/agents/save', async (req: Request, res: Response) => {
  try {
    const { agents } = req.body;
    if (!Array.isArray(agents) || agents.length === 0) {
      return res.status(400).json({ success: false, error: 'agents array is required' });
    }

    const results = [];

    for (const { id, chatappUserId, bitrixUserId } of agents) {
      if (!id) continue;

      // ── Uniqueness checks (must not be used by a different agent) ──────────

      if (bitrixUserId && /^\d+$/.test(String(bitrixUserId))) {
        const conflict = await prisma.agent.findFirst({
          where: { bitrixUserId: String(bitrixUserId), NOT: { id } },
        });
        if (conflict) {
          return res.status(409).json({
            success: false,
            error: `Bitrix User ID ${bitrixUserId} is already assigned to agent "${conflict.name}"`,
          });
        }
      }

      if (chatappUserId && String(chatappUserId).trim()) {
        const conflict = await prisma.agent.findFirst({
          where: { chatappUserId: String(chatappUserId), NOT: { id } },
        });
        if (conflict) {
          return res.status(409).json({
            success: false,
            error: `ChatApp Responsible ID ${chatappUserId} is already assigned to agent "${conflict.name}"`,
          });
        }
      }

      // ── Build update payload ───────────────────────────────────────────────

      const data: any = {
        chatappUserId: chatappUserId ? String(chatappUserId) : null,
      };
      // Only update bitrixUserId if a valid numeric value is provided (field is non-nullable in schema)
      if (bitrixUserId && /^\d+$/.test(String(bitrixUserId))) {
        data.bitrixUserId = String(bitrixUserId);
      }

      // Fetch real name + email from Bitrix24 when a valid numeric ID is provided
      if (data.bitrixUserId) {
        const bitrixUser = await fetchBitrixUser(data.bitrixUserId);
        if (bitrixUser && !('error' in bitrixUser)) {
          if (bitrixUser.name) data.name = bitrixUser.name;
          if (bitrixUser.email) data.email = bitrixUser.email;
          logger.info(`Fetched Bitrix24 details for user ${bitrixUserId}: ${bitrixUser.name}`);
        } else if (bitrixUser && 'error' in bitrixUser) {
          logger.warn(`Save: could not fetch Bitrix24 user ${bitrixUserId}: ${bitrixUser.error}`);
        }
      }

      const agent = await prisma.agent.update({
        where: { id },
        data,
        select: { id: true, name: true, email: true, bitrixUserId: true, chatappUserId: true },
      });

      results.push(agent);
      logger.info(`Updated agent ${agent.name} → bitrixUserId=${bitrixUserId}, chatappUserId=${chatappUserId}`);
    }

    res.json({ success: true, agents: results });
  } catch (err: any) {
    logger.error('Failed to save agents:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/admin/sync ─────────────────────────────────────────────────────

/**
 * Sync name + email from Bitrix24 for all agents that have a numeric bitrixUserId set.
 */
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const allAgents = await prisma.agent.findMany({
      select: { id: true, name: true, email: true, bitrixUserId: true },
    });

    const agents = allAgents.filter(
      (a) => a.bitrixUserId && /^\d+$/.test(a.bitrixUserId)
    );

    const synced = [];
    const failed = [];
    const errors: string[] = [];

    for (const agent of agents) {
      const result = await fetchBitrixUser(agent.bitrixUserId!);
      if (!result) {
        errors.push(`ID ${agent.bitrixUserId}: unknown error`);
        continue;
      }
      if ('error' in result) {
        errors.push(`ID ${agent.bitrixUserId}: ${result.error}`);
        failed.push(agent.bitrixUserId);
        continue;
      }

      const updateData: any = { name: result.name || agent.name };

      // Only update email if non-empty and not already taken by another agent
      if (result.email) {
        const emailConflict = await prisma.agent.findFirst({
          where: { email: result.email, NOT: { id: agent.id } },
        });
        if (emailConflict) {
          logger.warn(`Sync: email ${result.email} from Bitrix24 already belongs to agent "${emailConflict.name}" — skipping email update for "${agent.name}"`);
        } else {
          updateData.email = result.email;
        }
      }

      const updated = await prisma.agent.update({
        where: { id: agent.id },
        data: updateData,
        select: { id: true, name: true, email: true, bitrixUserId: true, chatappUserId: true },
      });
      synced.push(updated);
      logger.info(`Synced agent ${updated.name} from Bitrix24`);
    }

    res.json({
      success: true,
      total: agents.length,
      synced: synced.length,
      failed: failed.length,
      agents: synced,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    logger.error('Failed to sync agents:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/admin/bitrix-users ─────────────────────────────────────────────

/**
 * Returns all active Bitrix24 users so the admin can pick from a dropdown
 * instead of manually looking up numeric IDs.
 */
router.get('/bitrix-users', async (_req: Request, res: Response) => {
  try {
    const url = `${config.bitrix24.webhookUrl}user.get.json`;
    const response = await axios.post(url, { FILTER: { ACTIVE: 'Y' } });

    if (response.data?.error) {
      const msg = response.data.error_description || response.data.error;
      return res.status(502).json({ success: false, error: msg });
    }

    const users = (response.data?.result || []).map((u: any) => ({
      id: String(u.ID),
      name: `${u.NAME || ''} ${u.LAST_NAME || ''}`.trim() || u.EMAIL || `User ${u.ID}`,
      email: u.EMAIL || '',
    }));

    return res.json({ success: true, users });
  } catch (err: any) {
    logger.error('Failed to fetch Bitrix24 users:', err.message);
    return res.status(502).json({ success: false, error: 'Could not reach Bitrix24' });
  }
});

// ─── DELETE /api/admin/agents/:id ────────────────────────────────────────────

router.delete('/agents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.agent.delete({ where: { id } });
    logger.info(`Deleted agent ${id}`);
    res.json({ success: true });
  } catch (err: any) {
    logger.error('Failed to delete agent:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
