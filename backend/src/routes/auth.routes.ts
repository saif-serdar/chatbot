import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { logger } from '../utils/logger';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Register new agent
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { bitrixUserId, email, name, password, role } = req.body;

    if (!bitrixUserId || !email || !name || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await authService.register({
      bitrixUserId,
      email,
      name,
      password,
      role,
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Register error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await authService.login(email, password);

    res.json(result);
  } catch (error: any) {
    logger.error('Login error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Get current user
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const agent = await authService.getAgentById(req.user!.id);
    res.json(agent);
  } catch (error: any) {
    logger.error('Get me error:', error);
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

// Verify token
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    const decoded = await authService.verifyToken(token);
    res.json({ valid: true, user: decoded });
  } catch (error: any) {
    res.status(401).json({ valid: false, error: error.message });
  }
});

export default router;
