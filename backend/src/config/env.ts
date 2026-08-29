import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  DATABASE_URL: required(
    'DATABASE_URL',
    'postgresql://artho:artho@localhost:5544/artho'
  ),
  DB_POOL_MIN: parseInt(process.env.DB_POOL_MIN ?? '2', 10),
  DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
  JWT_SECRET: required('JWT_SECRET', 'dev-super-secret-key-min-32-chars-change-me'),
  JWT_EXPIRATION: parseInt(process.env.JWT_EXPIRATION ?? '86400', 10),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  INITIAL_BALANCE_PAISA: BigInt(process.env.INITIAL_BALANCE_PAISA ?? '10000000'),
};
