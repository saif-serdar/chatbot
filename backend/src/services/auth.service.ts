import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

class AuthService {
  async register(params: {
    bitrixUserId: string;
    email: string;
    name: string;
    password: string;
    role?: string;
  }) {
    try {
      // Check if user already exists
      const existingUser = await prisma.agent.findFirst({
        where: {
          OR: [   
            { bitrixUserId: params.bitrixUserId },
            { email: params.email },
          ],
        },
      });

      if (existingUser) {
        throw new AppError('User already exists', 400);
      }

      // Hash password
      const passwordHash = await bcrypt.hash(params.password, 10);

      // Create user
      const agent = await prisma.agent.create({
        data: {
          bitrixUserId: params.bitrixUserId,
          email: params.email,
          name: params.name,
          passwordHash,
          role: params.role || 'agent',
        },
      });

      // Generate token
      const token = this.generateToken(agent);

      return {
        agent: this.sanitizeAgent(agent),
        token,
      };
    } catch (error) {
      logger.error('Registration error:', error);
      throw error;
    }
  }

  async login(email: string, password: string) {
    try {
      // Find user
      const agent = await prisma.agent.findUnique({
        where: { email },
      });

      if (!agent) {
        throw new AppError('Invalid credentials', 401);
      }

      if (!agent.isActive) {
        throw new AppError('Account is deactivated', 403);
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, agent.passwordHash || '');

      if (!isPasswordValid) {
        throw new AppError('Invalid credentials', 401);
      }

      // Generate token
      const token = this.generateToken(agent);

      return {
        agent: this.sanitizeAgent(agent),       
        token,
      };
    } catch (error) {
      logger.error('Login error:', error);
      throw error;
    }
  }

  async getAgentById(id: string) {
    try {
      const agent = await prisma.agent.findUnique({
        where: { id },
      });

      if (!agent) {
        throw new AppError('Agent not found', 404);
      }

      return this.sanitizeAgent(agent);
    } catch (error) {
      logger.error('Get agent error:', error);
      throw error;
    }
  }

  private generateToken(agent: any) {
    return jwt.sign(
      {
        id: agent.id,
        bitrixUserId: agent.bitrixUserId,
        email: agent.email,
        role: agent.role,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
  }

  private sanitizeAgent(agent: any) {
    const { passwordHash, ...sanitized } = agent;
    return sanitized;
  }

  async verifyToken(token: string) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as {
        id: string;
        bitrixUserId: string;
        email: string;
        role: string;
      };

      return decoded;
    } catch (error) {
      throw new AppError('Invalid token', 401);
    }
  }
}

export const authService = new AuthService();
