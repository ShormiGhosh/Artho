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

Demo accounts (password `Test123456`): `rana@example.com`, `fatima@example.com`,
`arjun@example.com`, `nasrin@example.com`.

## Verify the guarantees

```bash
cd backend
npm test                       # money-math unit tests (no DB)
node scripts/smoke.mjs         # 27 end-to-end assertions against a running API
```

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
  pages/        Login, Register, Dashboard, SendMoney (4-step), RequestMoney,
                Requests, RequestDetails, History (filters + date range + ID lookup),
                TransactionDetails, Profile
  context/      AuthContext
  lib/          api (axios + idempotency key), format (paisa-safe display)
```
