import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;

function resolveDatabaseUrl(): string {
  const baseDir = (process as any).pkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
  const dbDir = path.join(baseDir, 'db');

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const configured = process.env.DATABASE_URL;
  if (configured && configured.trim().length > 0) {
    return configured;
  }

  return `file:${path.join(dbDir, 'hn.sqlite')}`;
}

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    const url = resolveDatabaseUrl();
    process.env.DATABASE_URL = url;
    prisma = new PrismaClient({
      datasources: {
        db: { url },
      },
    });
  }
  return prisma;
}

export async function initPrisma(): Promise<void> {
  await getPrismaClient().$connect();
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
