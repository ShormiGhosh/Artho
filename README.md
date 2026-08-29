# Artho

A closed-ecosystem digital wallet for peer-to-peer transfers and money requests,
built for the **PSTU IT Carnival 2026** hackathon challenge.

The point of this build is not feature breadth — it is that **moving money is a
correctness, concurrency, and trust problem**. Every design choice below is aimed
at that.

## What makes it correct

| Concern | How it is handled |
| --- | --- |
| **Atomicity** | Debit, credit, two ledger entries and the transfer row all commit in one `SERIALIZABLE` transaction, or none do. |
| **No overdraft under concurrency** | Both wallets are `SELECT … FOR UPDATE`-locked in a deterministic order (lower `user_id` first). A `CHECK (balance_paisa >= 0)` constraint is the last line of defence. Serialization failures auto-retry with backoff. |
| **Idempotency** | `Idempotency-Key` header → `idempotency_records` row. First call runs; replays return the stored response verbatim; same key + different body → `409`; a still-processing key → `409` (safe to poll). The `transfers` table also has `UNIQUE (sender_id, idempotency_key)` as a second guard, so the service is exactly-once even when called internally (request approval). |
| **No floating point** | All money is `BIGINT` **paisa**. User input is parsed with a strict `^\d+(\.\d{1,2})?$` grammar; display formatting is the only place division happens. |
| **Auditability** | `ledger_entries` is append-only, one row per balance change, each carrying `balance_after`. |
| **System invariant** | `Σ wallet balances == Σ ledger entries`. Checked on startup (refuses to boot on drift) and exposed at `GET /api/health/invariants`. |
| **Definitive status** | Every transfer has a terminal `COMPLETED` / `FAILED` state and a copyable `TXN-…` reference. Failed attempts are still recorded with a reason. |
| **Clear failures** | Typed error codes (`INSUFFICIENT_BALANCE`, `RECEIVER_NOT_FOUND`, …) with human messages — never "something went wrong". |
| **Stipends / scholarships / grants** | An institution account runs a programme and disburses to enrolled beneficiaries — one at a time or a pasted **roster of thousands** (`email`/`nid`, optional per-row amount, `dry_run` preview, optional `auto_enroll`). Bulk runs in the background; poll the disbursement resource for progress. NID linkage + account-active gates decide eligibility; stipend funds are tagged and carry **no cash-out fee**. |
| **Exactly-once disbursement** | Three layers: the batch stores the client `Idempotency-Key`, UNIQUE per programme, so a retry (or a crash-recovery resume) always lands on the **same** disbursement id; each payment uses the deterministic key `dsb-<disbursementId>-<userId>` against `transfers`' UNIQUE(sender_id, key); and before paying, the engine checks whether that transfer already succeeded and just reconciles the row. A startup + 60 s sweep finishes any batch left in `PROCESSING`. Proven: 4 concurrent identical calls → 1 batch, 1 payment; a batch forced back to `PROCESSING` with items reset → resumes with **zero** double-payments and one transfer row per beneficiary. |

## Stack

- **Backend** — Node 18+ / Express / TypeScript / PostgreSQL 15 (`pg`), JWT auth, bcrypt, zod validation.
- **Frontend** — React 18 / Vite / TypeScript / Tailwind / React Router / Axios.
- **DB** — PostgreSQL in Docker.

## Run it

```bash
# 1. Postgres (host port 5544 to avoid clashing with a local install)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
npm install
npm run migrate        # applies src/database/migrations/*.sql
npm run seed           # 4 demo users, each funded ৳100,000
npm run dev            # http://localhost:3000

# 3. Frontend (separate terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api -> :3000)
```

Demo accounts (password `Test123456`): individuals `rana@example.com`,
`fatima@example.com`, `arjun@example.com`, `nasrin@example.com`; institution
`board@example.com` (Chattogram Education Board — owns a seeded "Primary Education
Stipend 2026" programme with Rana, Fatima and Arjun enrolled).

## Verify the guarantees

```bash
cd backend
npm test                          # money-math unit tests (no DB)
node scripts/smoke.mjs            # 27 core end-to-end assertions
node scripts/phase3.mjs           # 35 — money requests + unified history
node scripts/phase3b.mjs          # 24 — request detail + transaction lookup
node scripts/stipends.mjs         # 36 — programmes, enrolment, disbursement, NID gates
node scripts/bulk-stipends.mjs    # 24 — bulk roster + standard-disburse idempotency
node scripts/resume-stipends.mjs  # 11 — crash-recovery: resume without double-paying
```

> The register endpoint is rate-limited (10/min per IP); run the `scripts/*.mjs`
> suites a minute apart or they trip 429s.

`smoke.mjs` proves, among other things: idempotent replay does not double-debit;
a key reused with a different body is rejected; **5 parallel transfers from a
wallet that can only fund 3 → exactly 3 succeed, 2 fail, final balance exact**;
request approve/reject/cancel; and the system invariant holds at zero drift.

## API surface

```
POST   /api/auth/register            POST /api/auth/login
GET    /api/auth/me                  POST /api/auth/change-password
GET    /api/wallet
GET    /api/users/search?q=
POST   /api/transfers                (Idempotency-Key required)  -> 202
GET    /api/transfers?page&limit&status&direction
GET    /api/transfers/:idOrReference
POST   /api/money-requests
GET    /api/money-requests?direction&status
GET    /api/money-requests/:idOrReference          (detail for either party)
POST   /api/money-requests/:id/approve   (Idempotency-Key required)
POST   /api/money-requests/:id/reject    ({ reason? })
DELETE /api/money-requests/:id
GET    /api/transactions?kind&status&from&to   (unified feed, date range)
GET    /api/transactions/lookup?ref=            (resolves TXN- or REQ- or UUID)
GET    /api/transactions/ledger
GET    /api/notifications            POST /api/notifications/:id/read
GET    /api/health   GET /api/health/invariants

PATCH  /api/auth/me                             ({ full_name?, nid? })

# Stipend / scholarship / grant programmes  (owner = INSTITUTION account)
POST   /api/stipend-programs                    ({ name, category, description? })
GET    /api/stipend-programs                    (owner: owned; user: enrolled)
GET    /api/stipend-programs/:idOrRef
POST   /api/stipend-programs/:id/close
POST   /api/stipend-programs/:id/beneficiaries  ({ user_id, guardian_nid, institution_name, default_amount_bdt? })
GET    /api/stipend-programs/:id/beneficiaries
PATCH  /api/stipend-programs/:id/beneficiaries/:bid   ({ status?|guardian_nid?|institution_name?|default_amount_bdt? })
DELETE /api/stipend-programs/:id/beneficiaries/:bid
POST   /api/stipend-programs/:id/disburse       (Idempotency-Key; { note?, amount_bdt?, items? })
POST   /api/stipend-programs/:id/bulk-disburse  ({ rows:[{email|nid|user_id, amount_bdt?}], dry_run?, auto_enroll?, default_amount_bdt?, default_institution_name? }; Idempotency-Key unless dry_run) -> 202
GET    /api/stipend-programs/:id/disbursements
GET    /api/stipend-disbursements/:idOrRef      (poll for bulk progress: status, processed_count, unresolved)
GET    /api/stipends/received                   (beneficiary's own view)
```

## Layout

```
backend/src
  config/       env, constants, database (SERIALIZABLE tx helper + retry)
  database/     migrations/, migrate.ts, seed.ts
  middleware/   auth, idempotency, validate (zod), rateLimit, errorHandler
  services/     transfer (core engine), request, auth, wallet, history,
                notification, invariant
  routes/       thin wiring per domain
frontend/src
  pages/        Login, Register (individual / institution), Dashboard,
                SendMoney (4-step), RequestMoney, Requests, RequestDetails,
                History (filters + date range + ID lookup), TransactionDetails,
                Programmes + ProgramDetail (enrol / disburse / batch history) [institution],
                Stipends [individual], Profile (NID)
  context/      AuthContext
  lib/          api (axios + idempotency key), format (paisa-safe display)
```
