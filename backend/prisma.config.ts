import { defineConfig } from 'prisma/config';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  schema: './prisma/schema.prisma',
  engine: 'classic',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
