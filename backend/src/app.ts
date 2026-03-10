import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler, notFound } from './middleware/errorHandler';
import { logger } from './utils/logger';

// Import routes
import authRoutes from './routes/auth.routes';
import chatRoutes from './routes/chat.routes';
import webhookRoutes from './routes/webhook.routes';
import leadsRoutes from './routes/leads.routes';
import syncRoutes from './routes/sync.routes';
import adminRoutes from './routes/admin.routes';

export function createApp(): Application {
  const app = express();

  // Trust proxy (for ngrok/reverse proxies)
  app.set('trust proxy', 1);

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: config.frontendUrl,
    credentials: true,
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later',
  });
  app.use('/api/', limiter);

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Logging middleware
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/leads', leadsRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/admin', adminRoutes);

  // 404 handler
  app.use(notFound);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
