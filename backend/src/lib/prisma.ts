import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../config';

const pool = new Pool({ connectionString: config.database.url });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
