import bcrypt from 'bcryptjs';
import { logger } from './logger';
import { prisma } from '../lib/prisma';

async function seed() {
  try {
    logger.info('Starting database seed...');

    // Create demo agent
    const passwordHash = await bcrypt.hash('password123', 10);

    const agent = await prisma.agent.upsert({
      where: { email: 'demo@example.com' },
      update: {},
      create: {
        bitrixUserId: 'demo_user_1',
        email: 'demo@example.com',
        name: 'Demo Agent',
        role: 'agent',
        passwordHash,
      },
    });

    logger.info(`Created demo agent: ${agent.email}`);

    // Create demo lead
    const lead = await prisma.lead.upsert({
      where: { bitrixLeadId: 'demo_lead_1' },
      update: {},
      create: {
        bitrixLeadId: 'demo_lead_1',
        agentId: agent.id,
        name: 'John Doe',
        phone: '+1234567890',
        email: 'john.doe@example.com',
        status: 'active',
        source: 'whatsapp',
      },
    });

    logger.info(`Created demo lead: ${lead.name}`);

    // Create demo messages
    const messages = [
      {
        content: 'Hi, I am interested in your product',
        type: 'whatsapp',
        source: 'wazzup',
        direction: 'inbound',
      },
      {
        content: 'Great! I would be happy to help you. What specific features are you looking for?',
        type: 'whatsapp',
        source: 'wazzup',
        direction: 'outbound',
      },
      {
        content: 'I need something that can handle large volumes of data',
        type: 'whatsapp',
        source: 'wazzup',
        direction: 'inbound',
      },
      {
        content: 'Our enterprise plan would be perfect for that. It supports unlimited data processing.',
        type: 'whatsapp',
        source: 'wazzup',
        direction: 'outbound',
      },
    ];

    for (const msgData of messages) {
      await prisma.message.create({
        data: {
          leadId: lead.id,
          agentId: agent.id,
          ...msgData,
        },
      });
    }

    logger.info(`Created ${messages.length} demo messages`);

    logger.info('Database seed completed successfully!');
    logger.info('\nDemo credentials:');
    logger.info('Email: demo@example.com');
    logger.info('Password: password123');
  } catch (error) {
    logger.error('Seed failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seed();
