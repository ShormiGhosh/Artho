import type { PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import { pool, closePool } from '../config/database';
import {
  INITIAL_BALANCE_PAISA,
  INSTITUTION_INITIAL_BALANCE_PAISA,
} from '../config/constants';
import { newStipendProgramReference } from '../utils/reference';
import { runMigrations } from './migrate';

const DEMO_PASSWORD = 'Test123456';

const DEMO_USERS = [
  { email: 'rana@example.com', full_name: 'Rana Ahmed', nid: '1990123456789' },
  { email: 'fatima@example.com', full_name: 'Fatima Khan', nid: '1985123456789' },
  { email: 'arjun@example.com', full_name: 'Arjun Roy', nid: '1992123456789' },
  { email: 'nasrin@example.com', full_name: 'Nasrin Begum', nid: null },
];

const INSTITUTION = {
  email: 'board@example.com',
  full_name: 'Chattogram Education Board',
};

async function createUser(
  client: PoolClient,
  u: { email: string; full_name: string; role?: string; nid?: string | null },
  hash: string,
  openingPaisa: bigint
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, role, nid)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [u.email, hash, u.full_name, u.role ?? 'USER', u.nid ?? null]
  );
  const id = res.rows[0].id;
  await client.query(`INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, $2)`, [
    id,
    openingPaisa.toString(),
  ]);
  await client.query(
    `INSERT INTO ledger_entries (user_id, amount_paisa, balance_after, transfer_id, entry_type)
     VALUES ($1, $2, $2, NULL, 'INITIAL_FUNDING')`,
    [id, openingPaisa.toString()]
  );
  return id;
}

async function seed() {
  await runMigrations();

  const existing = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (existing.rows[0].c > 0) {
    console.log('[seed] users already exist, skipping');
    return;
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userIds: Record<string, string> = {};
    for (const u of DEMO_USERS) {
      userIds[u.email] = await createUser(client, u, hash, INITIAL_BALANCE_PAISA);
      console.log(`[seed] created ${u.full_name} <${u.email}>`);
    }

    const boardId = await createUser(
      client,
      { ...INSTITUTION, role: 'INSTITUTION' },
      hash,
      INSTITUTION_INITIAL_BALANCE_PAISA
    );
    console.log(`[seed] created institution ${INSTITUTION.full_name} <${INSTITUTION.email}>`);

    // A primary-level stipend programme with three enrolled beneficiaries
    // (Nasrin has no NID on file yet, so she is left out — demonstrates the gate).
    const program = await client.query<{ id: string }>(
      `INSERT INTO stipend_programs (reference, owner_id, name, category, description, updated_at)
       VALUES ($1, $2, $3, 'STIPEND', $4, NOW()) RETURNING id`,
      [
        newStipendProgramReference(),
        boardId,
        'Primary Education Stipend 2026',
        'Quarterly upabritti for primary-level students, credited straight to the guardian bKash/Artho account. No cash-out fee.',
      ]
    );
    const programId = program.rows[0].id;

    const enrollments = [
      { email: 'rana@example.com', nid: '1990123456789', school: 'Government Primary School, Kotwali', amount: 50000 },
      { email: 'fatima@example.com', nid: '1985123456789', school: 'Muslim High School (Primary Section)', amount: 50000 },
      { email: 'arjun@example.com', nid: '1992123456789', school: 'Nasirabad Govt. Primary School', amount: 75000 },
    ];
    for (const e of enrollments) {
      await client.query(
        `INSERT INTO stipend_beneficiaries
           (program_id, user_id, guardian_nid, institution_name, default_amount_paisa, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [programId, userIds[e.email], e.nid, e.school, e.amount]
      );
    }
    console.log('[seed] created programme "Primary Education Stipend 2026" with 3 beneficiaries');

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`[seed] done. All demo accounts share password: ${DEMO_PASSWORD}`);
  console.log('[seed] institution login: board@example.com');
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
