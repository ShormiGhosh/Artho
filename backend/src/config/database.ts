import { Pool, PoolClient, types } from 'pg';
import { env } from './env';

// BIGINT (OID 20) -> native BigInt so money math never touches floating point.
types.setTypeParser(20, (val) => (val === null ? null : BigInt(val)));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  min: env.DB_POOL_MIN,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Errors on idle clients should not crash the process.
  console.error('[db] unexpected idle client error', err);
});

export async function verifyConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT NOW() as now');
    console.log('[db] connected at', rows[0].now);
  } finally {
    client.release();
  }
}

export async function query<T = any>(text: string, params?: any[]) {
  return pool.query<T>(text, params);
}

/**
 * Run `callback` inside a SERIALIZABLE transaction.
 * Automatically retries on serialization failures (SQLSTATE 40001) and
 * deadlocks (40P01) with exponential backoff.
 */
export async function withSerializableTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      const retryable = err?.code === '40001' || err?.code === '40P01';
      if (retryable && attempt < maxRetries) {
        attempt += 1;
        const delay = 50 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
