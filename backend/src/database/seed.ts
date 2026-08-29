import bcrypt from 'bcryptjs';
import { pool, closePool } from '../config/database';
import { INITIAL_BALANCE_PAISA } from '../config/constants';
import { runMigrations } from './migrate';

const DEMO_PASSWORD = 'Test123456';

const DEMO_USERS = [
  { email: 'rana@example.com', full_name: 'Rana Ahmed' },
  { email: 'fatima@example.com', full_name: 'Fatima Khan' },
  { email: 'arjun@example.com', full_name: 'Arjun Roy' },
  { email: 'nasrin@example.com', full_name: 'Nasrin Begum' },
];

async function seed() {
  await runMigrations();

  const existing = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (existing.rows[0].c > 0) {
    console.log('[seed] users already exist, skipping');
    return;
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const u of DEMO_USERS) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
        [u.email, hash, u.full_name]
      );
      const id = res.rows[0].id;
      await client.query(`INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, $2)`, [
        id,
        INITIAL_BALANCE_PAISA.toString(),
      ]);
      await client.query(
        `INSERT INTO ledger_entries (user_id, amount_paisa, balance_after, transfer_id, entry_type)
         VALUES ($1, $2, $2, NULL, 'INITIAL_FUNDING')`,
        [id, INITIAL_BALANCE_PAISA.toString()]
      );
      await client.query('COMMIT');
      console.log(`[seed] created ${u.full_name} <${u.email}>`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  console.log(`[seed] done. All demo users share password: ${DEMO_PASSWORD}`);
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
