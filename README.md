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
| **Exactly-once** | Every transfer has an immutable UUID + `TXN-…` reference and an immutable idempotency key stored under `UNIQUE (sender_id, idempotency_key)`. A retried user action (double-click, timeout, client retry) **never** makes a second transfer: the HTTP `Idempotency-Key` middleware replays the stored response (`409` if still processing), and independently the service replays by key — `COMPLETED` → original result, `PENDING/PROCESSING` → current status, `FAILED` → the original failure (a genuinely new attempt uses a new key; internal flows opt into `onPriorFailure: 'retry'`). Concurrent identical requests race on `INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE` under SERIALIZABLE; one wins, the rest replay. A crash at any point cannot double-spend: the money tx is all-or-nothing and `verify()` reconciles the aftermath. |
| **Secure transactions** | Passwords hashed with bcrypt; NID **encrypted at rest** (AES-256-GCM) with an HMAC blind index for lookups, and only ever returned **masked** (`•••••••••4333`); logs redact `password/token/nid/…` keys; `helmet` + HSTS, optional plain-HTTP rejection behind a TLS proxy; changing a password **invalidates every existing session** — both the access token (`password_changed_at` check in `requireAuth`) and **every refresh-token family** for that user; every request carries a hashed IP/UA for the security log. |
| **Refresh token rotation + reuse detection** | The 15-minute access JWT is backed by a rotating opaque refresh token delivered **only** as an httpOnly, `SameSite=Lax` cookie scoped to `/api/auth` — never readable by JS, never in `localStorage`. Only its SHA-256 hash is stored (`refresh_tokens`). Every `POST /auth/refresh` retires the presented token (`ACTIVE → ROTATED`) and mints the next one in the same `family_id`, atomically. Presenting a token that is already `ROTATED` or `REVOKED` can only mean a stale copy is loose (client retry) or stolen — either way the **entire family is revoked** and the user is signed out on every device, logged as a `HIGH`-severity `REFRESH_TOKEN_REUSE_DETECTED` security event. A password change also revokes every family outright. See `backend/src/services/refreshToken.service.ts`; proven end-to-end by `scripts/auth-security.mjs` (rotation, replay of a stale token, and — the core property — that reuse kills even the *never-reused, currently-valid* latest token in that family). |
| **Phone + email verification (enforced)** | Registration requires a validated Bangladeshi phone number (unique) alongside email. New accounts start `PENDING_VERIFICATION` and a 6-digit, hashed, expiring (15 min, 5 attempts, 60 s resend cooldown) code is emailed via a swappable `EmailService`; `requireAuth` blocks a `PENDING_VERIFICATION` account from every money-moving and admin route (only `/auth/me`, `GET /wallet`, verify/resend/logout stay reachable) until `POST /auth/verify-email` confirms it. This is a real gate, not a UI-only nudge. No SMTP is configured in this environment, so `EmailService` logs the code and — **outside production only** — echoes it back in the API response (`verification.dev_code`) so the flow is testable without a mailbox; the frontend shows it inline as clearly-labelled dev mode. |
| **Fraud & risk scoring** | `POST /transfers` runs `auth → fraud analysis → risk score → LOW/MEDIUM/HIGH → allow / verify / block → exactly-once transfer`. The transparent score (0–100, with the weighted reasons that produced it) is persisted per `(user, idempotencyKey)` — so a retry re-uses the same decision and can neither bypass fraud nor duplicate the transfer. **LOW** proceeds; **MEDIUM** returns `VERIFICATION_REQUIRED` (no transfer) until the client re-submits the same key with the verification token; **HIGH** is `403`-blocked, the user is notified, and only an admin release lets it through. Detectors: large amount, hard cap (critical), amount vs. the user's own history, transfer velocity, rapid failed transfers, new/newly-registered recipient, recent failed logins (also a temporary account lockout — never a permanent ban), new device/session. Thresholds are configurable and live in `risk_config`. All of it lands in an append-only `security_events` log surfaced by an admin dashboard. |
| **No floating point** | All money is `BIGINT` **paisa**. User input is parsed with a strict `^\d+(\.\d{1,2})?$` grammar; display formatting is the only place division happens. |
| **Auditability** | `ledger_entries` is append-only, one row per balance change, each carrying `balance_after`. |
| **System invariant** | `Σ wallet balances == Σ ledger entries`. Checked on startup (refuses to boot on drift) and exposed at `GET /api/health/invariants`. |
| **Definitive status** | Every transfer has a terminal `COMPLETED` / `FAILED` state and a copyable `TXN-…` reference. Failed attempts are still recorded with a reason. |
| **Smart Money Recovery** | Transfers run through `PENDING → PROCESSING → COMPLETED/FAILED`, with `VERIFYING` for an uncertain one. A committed PENDING row + append-only `transfer_events` trail means an interrupted transfer is never lost. `POST /transfers/:ref/verify` ("What happened to my money?") reconciles against the immutable ledger and returns a definite outcome — `DELIVERED` (money moved, debited exactly once) or `NOT_SENT` (nothing left the account) — plus the full human-readable timeline. Idempotent; never moves money. `simulate: lost_response | crash_before_processing | crash_during_processing` on `POST /transfers` makes the failure demonstrable. |
| **Smart Debt Settlement** | Groups record an immutable ledger of who-owes-whom (`debts`, kinds `DEBT` / `EXPENSE_SHARE` / `SETTLEMENT_PAYMENT`). Net balances are exact integer paisa summing to zero. The optimiser (exact-match pass + greedy largest-vs-largest, deterministic) settles every balance in ≤ n−1 transfers — the spec example `A owes B 500, B owes C 800, C owes A 300` collapses to exactly `A→C 200, B→C 300`. Preview shows total outstanding, original debt count, optimised transfer count and the plan; a `plan_hash` guards against the debts changing between preview and confirm. `POST /debt-groups/:ref/settle` (Idempotency-Key) executes each plan line through `TransferService.execute` with a deterministic key `stl-<settlement>-<seq>` — retries/duplicates never double-pay, `FOR UPDATE` on the debts serialises concurrent settlements, and a partial failure reverts the originals + records the cleared transfers as live `SETTLEMENT_PAYMENT` debts so net balances stay correct. |
| **Clear failures** | Typed error codes (`INSUFFICIENT_BALANCE`, `RECEIVER_NOT_FOUND`, …) with human messages — never "something went wrong". |
| **Stipends / scholarships / grants** | An institution account runs a programme and disburses to enrolled beneficiaries — one at a time or a pasted **roster of thousands** (`email`/`nid`, optional per-row amount, `dry_run` preview, optional `auto_enroll`). Bulk runs in the background; poll the disbursement resource for progress. NID linkage + account-active gates decide eligibility; stipend funds are tagged and carry **no cash-out fee**. |
| **Exactly-once disbursement** | Three layers: the batch stores the client `Idempotency-Key`, UNIQUE per programme, so a retry (or a crash-recovery resume) always lands on the **same** disbursement id; each payment uses the deterministic key `dsb-<disbursementId>-<userId>` against `transfers`' UNIQUE(sender_id, key); and before paying, the engine checks whether that transfer already succeeded and just reconciles the row. A startup + 60 s sweep finishes any batch left in `PROCESSING`. Proven: 4 concurrent identical calls → 1 batch, 1 payment; a batch forced back to `PROCESSING` with items reset → resumes with **zero** double-payments and one transfer row per beneficiary. |
| **AI advisory layer (OpenAI)** | Three explanation-only features on top of the deterministic engine above — the AI never moves money, changes a balance, a transfer status, or a fraud decision. **Transaction Investigator**: `POST /ai/transactions/:ref/investigate` reconciles via the existing `verify()` (authoritative) and hands only the sanitised timeline/outcome to the model for a plain-language explanation; `money_status` is forced from the ledger outcome, never the model. **Fraud second opinion**: after the deterministic `scoreRisk` decides (and, unaffected, gates) a transfer, a fire-and-forget call analyses the same signals for a `risk_level`/`reasoning_summary`/`risk_factors`/`recommended_action` surfaced on the admin security dashboard, clearly labelled advisory-only. **Smart Financial Summaries**: `GET /ai/summary?period=weekly\|monthly` computes every total and a keyword-based spend category in SQL first; the model only narrates the finished numbers. All three cache by input hash (`ai_insights`, 6–24h TTL), rate-limit per user, retry/timeout/backoff on OpenAI failures, validate model output against a strict schema, and fall back to a deterministic explanation with `source: 'fallback'` if the key is missing or the call fails — the app runs identically without `OPENAI_API_KEY` set. See `backend/src/services/ai/`. |

## Stack

- **Backend** — Node 18+ / Express / TypeScript / PostgreSQL 15 (`pg`), JWT access tokens + rotating httpOnly-cookie refresh tokens, bcrypt, zod validation.
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
Stipend 2026" programme with Rana, Fatima and Arjun enrolled); security admin
`admin@example.com` (the fraud/security dashboard).

## Verify the guarantees

```bash
cd backend
npm test                          # unit tests (no DB): money math, risk scoring, settlement
                                  #   optimiser, spend categoriser, AI service (mocked OpenAI)
node scripts/smoke.mjs            # 27 core end-to-end assertions
node scripts/phase3.mjs           # 35 — money requests + unified history
node scripts/phase3b.mjs          # 24 — request detail + transaction lookup
node scripts/stipends.mjs         # 36 — programmes, enrolment, disbursement, NID gates
node scripts/bulk-stipends.mjs    # 24 — bulk roster + standard-disburse idempotency
node scripts/resume-stipends.mjs  # 11 — crash-recovery: resume without double-paying
node scripts/recovery.mjs         # 34 — Smart Money Recovery: simulate lost response /
                                  #      server crash, verify, timeline, no double-charge
node scripts/exactly-once.mjs     # 39 — double-click, repeated sends, timeout-after-success,
                                  #      concurrent identical, mid-tx crash rollback, insufficient
node scripts/settlement.mjs       # 42 — debt optimisation (spec example), preview counts,
                                  #      idempotent settle, stale-plan guard, partial failure,
                                  #      concurrent settle, expense split, access control
node scripts/fraud.mjs            # 40 — normal / suspicious / repeated-failure / high-value /
                                  #      concurrent transfers, MEDIUM verify, HIGH block +
                                  #      admin release, login lockout, masked NID, audit log
node scripts/ai.mjs               # 37 — AI investigator, fraud second opinion, financial
                                  #      summaries; passes with or without OPENAI_API_KEY set
node scripts/auth-security.mjs    # 36 — phone/verification enforcement, refresh rotation,
                                  #      reuse detection (family revoked, incl. the still-valid
                                  #      latest token), logout, password-change revoke-all
```

> The register endpoint is rate-limited (150/min per IP — bumped as this suite grew,
> each script registers several users); running everything back-to-back in a tight
> loop can still trip it, so space runs out a little if you see one crash on
> `reg.d.data` being undefined.

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
POST   /api/transfers                (Idempotency-Key required; { simulate?: lost_response | crash_before_processing | crash_during_processing })  -> 202
GET    /api/transfers?page&limit&status&direction
GET    /api/transfers/:idOrReference                (includes the events timeline)
POST   /api/transfers/:idOrReference/verify         "What happened to my money?" — reconcile + timeline
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

# Smart Debt Settlement
POST   /api/debt-groups                         ({ name, member_ids? })
GET    /api/debt-groups                          -> groups I'm in (+ my net balance)
GET    /api/debt-groups/:idOrRef                 -> members, net balances, debt history
POST   /api/debt-groups/:idOrRef/members         ({ user_id })
POST   /api/debt-groups/:idOrRef/debts           ({ debtor_id, creditor_id, amount_bdt, description? })
POST   /api/debt-groups/:idOrRef/expenses        ({ payer_id, amount_bdt, participant_ids[], description? })
GET    /api/debt-groups/:idOrRef/settlement-preview  -> totals + optimised plan + plan_hash
POST   /api/debt-groups/:idOrRef/settle          (Idempotency-Key; { plan_hash? })  -> settlement
GET    /api/debt-groups/:idOrRef/settlements
GET    /api/debt-settlements/:idOrRef            -> lines + resulting balances

# Fraud & Security Monitoring  (ADMIN role)
GET    /api/security/dashboard                   -> band/decision counts + flagged transactions
GET    /api/security/assessments?band&decision&page
GET    /api/security/assessments/:idOrRef        -> reasons + nearby security events
POST   /api/security/assessments/:id/release     ({ note? })  lift a HIGH-risk hold
POST   /api/security/assessments/:id/reject      ({ note? })  keep blocked, log the review
GET    /api/security/events?type&severity&page   -> the append-only security log
GET    /api/security/config   PUT /api/security/config   -> risk thresholds

# on POST /api/transfers the body may carry `risk_ack` (MEDIUM confirmation);
# the response is `{ status: 'VERIFICATION_REQUIRED', score, reasons, verification_token }`
# for MEDIUM, or `403 TRANSFER_BLOCKED_RISK` for HIGH.

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
                SendMoney (recipient→amount→confirm→result, + simulate + investigate
                  + MEDIUM risk verify + HIGH block screens),
                RequestMoney, Requests, RequestDetails,
                Groups + GroupDetail (record debts / split expenses / preview + settle),
                History (filters + date range + ID lookup), TransactionDetails
                  (lifecycle timeline + "What happened to my money?"),
                Programmes + ProgramDetail (enrol / disburse / bulk / batch history) [institution],
                Stipends [individual], SecurityDashboard [admin], Profile (masked NID)
  components/   MoneyRecovery (TransferTimeline, OutcomeBanner, InvestigationPanel)
  utils/settlement.ts   pure debt optimiser (computeNetBalances, optimizeSettlement, planHash)
  utils/riskScoring.ts  pure transaction risk scoring (scoreRisk → score + band + reasons)
  utils/crypto.ts       AES-256-GCM field encryption + HMAC blind index + maskNid
  context/      AuthContext
  lib/          api (axios + idempotency key), format (paisa-safe display)
```
