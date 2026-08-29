# IMPLEMENTATION GUIDE
## Money Movement Application - PSTU IT Carnival 2026

**This document is the IMPLEMENTATION PLAYBOOK.** Follow it step-by-step to build the MVP.

---

## 1. IMPLEMENTATION OVERVIEW

### 1.1 Project Structure & Timeline

```
PHASE 1: Foundation (0:00 - 1:30)
├─ Backend: Express setup, database, auth endpoints
├─ Frontend: React setup, login/register screens
└─ Deliverable: Login works, users created with ৳100K balance

PHASE 2: Money Movement (1:30 - 3:30)
├─ Backend: Transfer engine, atomic transactions, ledger
├─ Frontend: Send money flow, confirmation, success screens
└─ Deliverable: Transfers work, balances update correctly

PHASE 3: Requests & History (3:30 - 4:30)
├─ Backend: Money requests, history queries
├─ Frontend: Request UI, history, transaction details
└─ Deliverable: Complete workflow, searchable history

PHASE 4: Testing & Polish (4:30 - 5:15)
├─ Concurrency tests, idempotency tests, stress tests
├─ Error messages, mobile responsiveness
└─ Deliverable: System passes stress test

PHASE 5: Demo Prep (5:15 - 6:00)
├─ Demo script, data seeding, backup environment
└─ Deliverable: Ready for judging
```

### 1.2 Implementation Priorities

**P0 (Absolutely Required):**
- User registration + login
- Money transfer (send)
- Balance updates
- Transaction idempotency
- Basic error handling

**P1 (Important):**
- Money requests (request/approve/reject)
- Transaction history
- Concurrency safety
- Clear transaction status

**P2 (Nice-to-Have):**
- Push notifications
- UI animations
- Email notifications
- Advanced filtering

---

## 2. TECHNOLOGY STACK

### 2.1 Frontend
```
React 18.2+
  - State management: Redux Toolkit OR Context API
  - HTTP client: Axios 1.4+
  - CSS: Tailwind CSS 3.3+
  - Form validation: React Hook Form 7.x
  - Routing: React Router 6.x
  - Icons: lucide-react or react-icons
  
OR React Native (if mobile-first):
  - React Native 0.72+
  - Navigation: React Navigation 6.x
  - State: Redux Toolkit or Zustand
  - UI: React Native Paper or Tamagui
```

### 2.2 Backend
```
Node.js 18+ LTS
Express 4.18+
TypeScript 5.0+ (optional but recommended)
PostgreSQL 13+ (driver: pg 8.10+)
JWT: jsonwebtoken 9.0+
Password: bcrypt 5.1+
Validation: joi 17.x or zod 3.x
```

### 2.3 Database
```
PostgreSQL 13+
  - Isolation level: SERIALIZABLE
  - Connection pool: pg-pool (built-in to pg)
  - Migrations: node-pg-migrate 7.x
  
Optional:
  - Redis 7+ (caching, rate limiting)
  - PgBouncer (connection pooling for production)
```

### 2.4 Development Tools
```
Docker 20+
Docker Compose 2+
Git
Visual Studio Code or equivalent
Postman / Insomnia (API testing)
```

---

## 3. SYSTEM ARCHITECTURE

### 3.1 Component Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        WEB["Web Browser<br/>(React)"]
        MOBILE["Mobile App<br/>(React Native)"]
    end
    
    subgraph "API Gateway"
        LB["Load Balancer<br/>(Nginx/HAProxy)"]
    end
    
    subgraph "Backend Layer"
        AUTH["Auth Service<br/>(Register, Login, Tokens)"]
        WALLET["Wallet Service<br/>(Balance, Account)"]
        TRANSFER["Transfer Service<br/>(Atomic Transactions)"]
        REQUEST["Request Service<br/>(Money Requests)"]
        HISTORY["History Service<br/>(Queries, Ledger)"]
        NOTIFY["Notification Service<br/>(Async)"]
    end
    
    subgraph "Data Layer"
        DB["PostgreSQL<br/>(SERIALIZABLE)"]
        CACHE["Redis Cache<br/>(Optional)"]
    end
    
    WEB -->|HTTPS| LB
    MOBILE -->|HTTPS| LB
    LB -->|Routes| AUTH
    LB -->|Routes| WALLET
    LB -->|Routes| TRANSFER
    LB -->|Routes| REQUEST
    LB -->|Routes| HISTORY
    
    AUTH -->|ACID Transactions| DB
    WALLET -->|Read/Write| DB
    TRANSFER -->|Atomic Transactions| DB
    REQUEST -->|Atomic Transactions| DB
    HISTORY -->|Read Replica| DB
    NOTIFY -->|Async| CACHE
    
    DB -->|Query Results| HISTORY
    CACHE -->|TTL Cache| WALLET
```

### 3.2 Request/Response Flow (Transfer Example)

```
1. CLIENT INITIATES
   POST /transfers
   Authorization: Bearer [JWT]
   Idempotency-Key: req-user-TIMESTAMP-RANDOM
   Body: { receiver_id, amount_bdt, note }

2. BACKEND: AUTHENTICATION
   Verify JWT token
   Extract user_id
   IF invalid: Return 401 UNAUTHORIZED

3. BACKEND: INPUT VALIDATION
   Validate amount_bdt > 0 and ≤ 9,000,000,000
   Validate receiver_id is UUID format
   Validate note length ≤ 500
   IF invalid: Return 422 UNPROCESSABLE_ENTITY

4. BACKEND: IDEMPOTENCY CHECK
   SELECT * FROM idempotency_records
   WHERE user_id = $1 AND idempotency_key = $2
   IF found:
     Return cached result (202 ACCEPTED)
   ELSE:
     Proceed to transaction

5. BACKEND: PRE-FLIGHT BALANCE CHECK
   SELECT balance_paisa FROM wallets WHERE user_id = $1
   IF balance < amount: Return 402 PAYMENT_REQUIRED

6. BACKEND: ATOMIC TRANSACTION
   BEGIN TRANSACTION (SERIALIZABLE)
   
   -- Lock sender wallet
   SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE
   IF balance < amount: ROLLBACK, Return error
   
   -- Debit sender
   UPDATE wallets SET balance_paisa = balance_paisa - $2
   INSERT INTO ledger_entries (sender debit)
   
   -- Lock receiver wallet
   SELECT * FROM wallets WHERE user_id = $3 FOR UPDATE
   IF receiver inactive: ROLLBACK, Return error
   
   -- Credit receiver
   UPDATE wallets SET balance_paisa = balance_paisa + $2
   INSERT INTO ledger_entries (receiver credit)
   
   -- Record transfer
   INSERT INTO transfers (status = COMPLETED)
   
   -- Cache idempotency
   INSERT INTO idempotency_records (result)
   
   COMMIT TRANSACTION

7. BACKEND: ASYNC NOTIFICATION
   Queue notification to receiver (non-blocking)

8. BACKEND: RESPONSE
   Return 202 ACCEPTED with:
   {
     transfer_id: "TXN-20260829-XXXX",
     status: "COMPLETED",
     amount_bdt: 2500.00
   }

9. CLIENT: DISPLAY RESULT
   Show success screen with transaction ID
   Auto-refresh to dashboard after 3 seconds
   Allow user to view details
```

---

## 4. PROJECT STRUCTURE

### 4.1 Backend Structure

```
moneyflow-backend/
├── src/
│   ├── config/
│   │   ├── database.ts          # PostgreSQL connection
│   │   ├── jwt.ts               # JWT secret, expiration
│   │   ├── env.ts               # Environment variables
│   │   └── constants.ts         # INITIAL_BALANCE, etc.
│   │
│   ├── database/
│   │   ├── migrations/
│   │   │   ├── 001_users.sql
│   │   │   ├── 002_wallets.sql
│   │   │   ├── 003_transfers.sql
│   │   │   ├── 004_ledger.sql
│   │   │   ├── 005_requests.sql
│   │   │   └── 006_idempotency.sql
│   │   ├── schema.ts            # TypeScript types
│   │   └── index.ts             # Migration runner
│   │
│   ├── middleware/
│   │   ├── auth.ts              # JWT validation
│   │   ├── errorHandler.ts      # Global error handling
│   │   ├── validation.ts        # Input validation
│   │   ├── logging.ts           # Request logging
│   │   └── rateLimit.ts         # Rate limiting
│   │
│   ├── services/
│   │   ├── auth.service.ts      # Register, login logic
│   │   ├── wallet.service.ts    # Balance queries
│   │   ├── transfer.service.ts  # Transfer logic (CORE)
│   │   ├── request.service.ts   # Money request logic
│   │   ├── history.service.ts   # History queries
│   │   └── notification.service.ts
│   │
│   ├── routes/
│   │   ├── auth.routes.ts       # /auth/*
│   │   ├── wallet.routes.ts     # /wallet
│   │   ├── transfers.routes.ts  # /transfers/*
│   │   ├── requests.routes.ts   # /money-requests/*
│   │   ├── history.routes.ts    # /transactions/*
│   │   └── health.routes.ts     # /health
│   │
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── wallet.controller.ts
│   │   ├── transfer.controller.ts
│   │   └── request.controller.ts
│   │
│   ├── utils/
│   │   ├── errors.ts            # Error classes
│   │   ├── idempotency.ts       # Key generation/validation
│   │   ├── money.ts             # BDT/paisa conversion
│   │   ├── logger.ts            # Structured logging
│   │   └── validators.ts        # Reusable validators
│   │
│   └── app.ts                   # Express app setup
│
├── tests/
│   ├── unit/
│   │   ├── money.test.ts
│   │   └── validators.test.ts
│   ├── integration/
│   │   ├── auth.integration.test.ts
│   │   ├── transfer.integration.test.ts
│   │   └── request.integration.test.ts
│   ├── concurrency/
│   │   └── concurrent_transfers.test.ts
│   └── setup.ts                 # Test database setup
│
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

### 4.2 Frontend Structure

```
moneyflow-frontend/
├── src/
│   ├── components/
│   │   ├── auth/
│   │   │   ├── LoginForm.tsx
│   │   │   ├── RegisterForm.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   │
│   │   ├── wallet/
│   │   │   ├── BalanceDisplay.tsx
│   │   │   └── WalletCard.tsx
│   │   │
│   │   ├── transfers/
│   │   │   ├── SendMoneyForm.tsx
│   │   │   ├── RecipientSearch.tsx
│   │   │   ├── ConfirmationScreen.tsx
│   │   │   ├── SuccessScreen.tsx
│   │   │   └── ErrorScreen.tsx
│   │   │
│   │   ├── requests/
│   │   │   ├── MoneyRequestForm.tsx
│   │   │   ├── RequestList.tsx
│   │   │   └── ApprovalDialog.tsx
│   │   │
│   │   ├── history/
│   │   │   ├── TransactionList.tsx
│   │   │   ├── TransactionDetails.tsx
│   │   │   ├── TransactionFilter.tsx
│   │   │   └── TransactionCard.tsx
│   │   │
│   │   ├── common/
│   │   │   ├── Header.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── LoadingSpinner.tsx
│   │   │   └── ErrorBoundary.tsx
│   │   │
│   │   └── layout/
│   │       └── MainLayout.tsx
│   │
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── RegisterPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── SendMoneyPage.tsx
│   │   ├── RequestMoneyPage.tsx
│   │   ├── TransactionHistoryPage.tsx
│   │   ├── TransactionDetailsPage.tsx
│   │   └── ProfilePage.tsx
│   │
│   ├── services/
│   │   ├── api.ts               # Axios instance, base config
│   │   ├── auth.service.ts      # API calls for auth
│   │   ├── wallet.service.ts    # API calls for wallet
│   │   ├── transfer.service.ts  # API calls for transfers
│   │   ├── request.service.ts   # API calls for requests
│   │   └── history.service.ts   # API calls for history
│   │
│   ├── store/
│   │   ├── auth.slice.ts        # Redux auth state
│   │   ├── wallet.slice.ts      # Redux wallet state
│   │   ├── transactions.slice.ts
│   │   ├── ui.slice.ts          # Loading, errors
│   │   └── index.ts             # Store setup
│   │
│   ├── hooks/
│   │   ├── useAuth.ts           # Auth context/hook
│   │   ├── useWallet.ts         # Wallet hook
│   │   └── useTransaction.ts    # Transaction hook
│   │
│   ├── utils/
│   │   ├── formatters.ts        # BDT formatting
│   │   ├── validators.ts        # Form validators
│   │   └── errors.ts            # Error handling
│   │
│   ├── types/
│   │   └── index.ts             # TypeScript types
│   │
│   ├── App.tsx
│   ├── index.tsx
│   └── index.css
│
├── tests/
│   ├── components/
│   │   └── LoginForm.test.tsx
│   └── hooks/
│       └── useAuth.test.ts
│
├── .env.example
├── package.json
├── tsconfig.json
├── vite.config.ts (or webpack config)
└── README.md
```

---

## 5. DATABASE IMPLEMENTATION

### 5.1 Schema Definitions

**File: `src/database/migrations/001_users.sql`**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  account_status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP,
  
  CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created ON users(created_at DESC);
```

**File: `src/database/migrations/002_wallets.sql`**
```sql
CREATE TABLE wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  balance_paisa BIGINT NOT NULL DEFAULT 10000000,
    CHECK (balance_paisa >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'BDT',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  CONSTRAINT balance_non_negative CHECK (balance_paisa >= 0),
  CONSTRAINT max_balance CHECK (balance_paisa <= 9223372036854775807)
);

CREATE INDEX idx_wallet_balance ON wallets(balance_paisa);
CREATE INDEX idx_wallet_updated ON wallets(updated_at DESC);
```

**File: `src/database/migrations/003_transfers.sql`**
```sql
CREATE TABLE transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_paisa BIGINT NOT NULL,
    CHECK (amount_paisa > 0),
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  type VARCHAR(50) NOT NULL DEFAULT 'TRANSFER',
    CHECK (type IN ('TRANSFER', 'REQUEST_APPROVAL')),
  note VARCHAR(500),
  idempotency_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  failure_reason VARCHAR(255),
  
  CONSTRAINT not_self_transfer CHECK (sender_id != receiver_id),
  CONSTRAINT positive_amount CHECK (amount_paisa > 0),
  UNIQUE (sender_id, idempotency_key)
);

CREATE UNIQUE INDEX idx_transfer_id ON transfers(id);
CREATE INDEX idx_transfer_sender ON transfers(sender_id, created_at DESC);
CREATE INDEX idx_transfer_receiver ON transfers(receiver_id, created_at DESC);
CREATE INDEX idx_transfer_status ON transfers(status, created_at DESC);
CREATE INDEX idx_transfer_idempotency ON transfers(sender_id, idempotency_key);
CREATE INDEX idx_transfer_created ON transfers(created_at DESC);
```

**File: `src/database/migrations/004_ledger_entries.sql`**
```sql
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_paisa BIGINT NOT NULL,
  transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE RESTRICT,
  entry_type VARCHAR(50) NOT NULL,
    CHECK (entry_type IN ('TRANSFER_DEBIT', 'TRANSFER_CREDIT', 'INITIAL_FUNDING', 'CORRECTION')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  CONSTRAINT amount_signed CHECK (amount_paisa != 0)
);

CREATE INDEX idx_ledger_user ON ledger_entries(user_id, created_at DESC);
CREATE INDEX idx_ledger_transfer ON ledger_entries(transfer_id);
CREATE INDEX idx_ledger_type ON ledger_entries(entry_type, created_at DESC);
```

**File: `src/database/migrations/005_money_requests.sql`**
```sql
CREATE TABLE money_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requestee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount_paisa BIGINT NOT NULL,
    CHECK (amount_paisa > 0),
  reason VARCHAR(200),
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  related_transfer_id UUID REFERENCES transfers(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  
  CONSTRAINT not_self_request CHECK (requester_id != requestee_id)
);

CREATE INDEX idx_request_requester ON money_requests(requester_id, created_at DESC);
CREATE INDEX idx_request_requestee ON money_requests(requestee_id, status, created_at DESC);
CREATE INDEX idx_request_expires ON money_requests(expires_at) WHERE status = 'PENDING';
CREATE INDEX idx_request_status ON money_requests(status, created_at DESC);
```

**File: `src/database/migrations/006_idempotency_records.sql`**
```sql
CREATE TABLE idempotency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(255) NOT NULL,
  request_payload JSONB NOT NULL,
  response_payload JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',
    CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX idx_idempotency_user_key ON idempotency_records(user_id, idempotency_key);
CREATE INDEX idx_idempotency_expires ON idempotency_records(expires_at) WHERE status != 'COMPLETED';
```

**File: `src/database/migrations/007_notifications.sql`**
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
    CHECK (type IN ('TRANSFER_RECEIVED', 'REQUEST_RECEIVED', 'REQUEST_APPROVED', 
                     'REQUEST_REJECTED', 'REQUEST_CANCELLED', 'REQUEST_EXPIRED')),
  related_transfer_id UUID REFERENCES transfers(id) ON DELETE SET NULL,
  related_request_id UUID REFERENCES money_requests(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  CONSTRAINT has_related_id CHECK (related_transfer_id IS NOT NULL OR related_request_id IS NOT NULL)
);

CREATE INDEX idx_notification_user_read ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notification_user_created ON notifications(user_id, created_at DESC);
```

### 5.2 Database Connection (TypeScript)

**File: `src/config/database.ts`**
```typescript
import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '100', 10),
  min: parseInt(process.env.DB_POOL_MIN || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Verify connection on startup
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export async function verifyConnection(): Promise<void> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✓ Database connected:', result.rows[0]);
    client.release();
  } catch (err) {
    console.error('✗ Database connection failed:', err);
    throw err;
  }
}

export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, '../database/migrations');
  const files = fs.readdirSync(migrationsDir).sort();
  
  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      await pool.query(sql);
      console.log(`✓ Migration applied: ${file}`);
    } catch (err) {
      console.error(`✗ Migration failed: ${file}`, err);
      throw err;
    }
  }
}

export async function seedInitialData(): Promise<void> {
  // Only run if no users exist
  const result = await pool.query('SELECT COUNT(*) FROM users');
  if (parseInt(result.rows[0].count, 10) > 0) {
    console.log('✓ Database already seeded');
    return;
  }
  
  // Create test users
  const bcrypt = require('bcrypt');
  const hash1 = await bcrypt.hash('Test123456', 10);
  const hash2 = await bcrypt.hash('Test123456', 10);
  
  await pool.query(`
    INSERT INTO users (email, password_hash, full_name) VALUES
    ('rana@example.com', $1, 'Rana Ahmed'),
    ('fatima@example.com', $2, 'Fatima Khan');
  `, [hash1, hash2]);
  
  // Create initial wallets
  await pool.query(`
    INSERT INTO wallets (user_id, balance_paisa)
    SELECT id, 10000000 FROM users;
  `);
  
  // Create initial funding ledger entries
  await pool.query(`
    INSERT INTO ledger_entries (user_id, amount_paisa, transfer_id, entry_type)
    SELECT u.id, 10000000, u.id, 'INITIAL_FUNDING'
    FROM users u;
  `);
  
  console.log('✓ Initial data seeded');
}

export async function query(sql: string, params?: any[]): Promise<any> {
  try {
    const result = await pool.query(sql, params);
    return result;
  } catch (err) {
    console.error('Database query error:', err);
    throw err;
  }
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    
    const result = await callback(client);
    
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
```

### 5.3 Environment Variables

**File: `.env.example`**
```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/moneyflow_dev
DB_POOL_MIN=10
DB_POOL_MAX=100

# Server
NODE_ENV=development
PORT=3000
API_URL=http://localhost:3000

# JWT
JWT_SECRET=your-super-secret-key-min-32-chars-long-please
JWT_EXPIRATION=86400

# Frontend
REACT_APP_API_URL=http://localhost:3000

# Logging
LOG_LEVEL=debug
```

---

## 6. AUTHENTICATION IMPLEMENTATION

### 6.1 Password Hashing & Registration

**File: `src/services/auth.service.ts`**
```typescript
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';

export class AuthService {
  static async register(email: string, password: string, full_name: string) {
    // Validate input
    if (!email || !password || !full_name) {
      throw { code: 'INVALID_REQUEST', status: 400 };
    }
    
    if (password.length < 8) {
      throw { code: 'WEAK_PASSWORD', status: 422 };
    }
    
    // Check if email exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    if (existing.rows.length > 0) {
      throw { code: 'EMAIL_ALREADY_REGISTERED', status: 409 };
    }
    
    // Hash password
    const password_hash = await bcrypt.hash(password, 10);
    
    // Create user and wallet in transaction
    const result = await pool.query(`
      WITH new_user AS (
        INSERT INTO users (email, password_hash, full_name)
        VALUES ($1, $2, $3)
        RETURNING id
      ),
      new_wallet AS (
        INSERT INTO wallets (user_id, balance_paisa)
        SELECT id, 10000000 FROM new_user
        RETURNING user_id, balance_paisa
      ),
      ledger_entry AS (
        INSERT INTO ledger_entries (user_id, amount_paisa, transfer_id, entry_type)
        SELECT u.id, 10000000, u.id, 'INITIAL_FUNDING'
        FROM new_user u
      )
      SELECT nw.user_id, nw.balance_paisa FROM new_wallet nw;
    `, [email.toLowerCase(), password_hash, full_name]);
    
    const user_id = result.rows[0].user_id;
    const token = this.generateToken(user_id);
    
    return {
      user_id,
      email,
      full_name,
      token,
      token_expires_in: 86400,
      wallet: {
        balance_bdt: 100000.00,
        balance_paisa: 10000000,
        currency: 'BDT'
      }
    };
  }
  
  static async login(email: string, password: string) {
    // Check rate limiting (simple: not in MVP, but structure for it)
    
    // Get user
    const result = await pool.query(
      'SELECT id, password_hash, full_name FROM users WHERE email = $1 AND account_status = $2',
      [email.toLowerCase(), 'ACTIVE']
    );
    
    if (result.rows.length === 0) {
      throw { code: 'INVALID_CREDENTIALS', status: 401 };
    }
    
    const user = result.rows[0];
    
    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw { code: 'INVALID_CREDENTIALS', status: 401 };
    }
    
    // Update last login
    await pool.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );
    
    const token = this.generateToken(user.id);
    
    return {
      user_id: user.id,
      token,
      token_expires_in: 86400
    };
  }
  
  static generateToken(user_id: string): string {
    return jwt.sign(
      { user_id, issued_at: Date.now() },
      process.env.JWT_SECRET!,
      { expiresIn: '24h' }
    );
  }
  
  static verifyToken(token: string): { user_id: string } {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      return { user_id: decoded.user_id };
    } catch (err) {
      throw { code: 'UNAUTHORIZED', status: 401 };
    }
  }
}
```

### 6.2 Authentication Middleware

**File: `src/middleware/auth.ts`**
```typescript
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';

export interface AuthenticatedRequest extends Request {
  user_id?: string;
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' }
      });
    }
    
    const token = authHeader.substring(7);
    const { user_id } = AuthService.verifyToken(token);
    
    req.user_id = user_id;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid token' }
    });
  }
}

export function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { user_id } = AuthService.verifyToken(token);
      req.user_id = user_id;
    }
  } catch {
    // Optional, ignore errors
  }
  next();
}
```

---

## 7. MONEY REPRESENTATION

### 7.1 BDT/Paisa Conversion

**File: `src/utils/money.ts`**
```typescript
/**
 * Money utility functions
 * All money is stored as BIGINT paisa (1/100 of BDT)
 * Never use floating-point for financial calculations
 */

// Constants
export const PAISA_PER_BDT = 100;
export const MIN_TRANSFER = 1; // paisa
export const MAX_TRANSFER = 9223372036854775807; // BIGINT max (also practical limit)

/**
 * Convert user input (BDT string) to paisa (BIGINT)
 * @param bdt_string "2500" or "2500.50"
 * @returns amount in paisa or null if invalid
 */
export function bdt_to_paisa(bdt_string: string | number): number | null {
  try {
    // Parse as float
    let bdt_value: number;
    if (typeof bdt_string === 'string') {
      bdt_value = parseFloat(bdt_string);
    } else {
      bdt_value = bdt_string;
    }
    
    if (isNaN(bdt_value) || bdt_value <= 0) {
      return null; // Invalid
    }
    
    // Check for more than 2 decimals
    const parts = bdt_string.toString().split('.');
    if (parts[1] && parts[1].length > 2) {
      return null; // Too many decimals
    }
    
    // Convert to paisa
    const paisa = Math.round(bdt_value * PAISA_PER_BDT);
    
    // Verify it's a whole number (no fractional paisa)
    if (paisa !== Math.floor(paisa)) {
      return null;
    }
    
    // Check bounds
    if (paisa < MIN_TRANSFER || paisa > MAX_TRANSFER) {
      return null;
    }
    
    return paisa;
  } catch {
    return null;
  }
}

/**
 * Convert paisa (BIGINT) to BDT (for display)
 * @param paisa amount in paisa
 * @returns formatted BDT string "2500.00"
 */
export function paisa_to_bdt(paisa: number | bigint): string {
  const p = typeof paisa === 'bigint' ? Number(paisa) : paisa;
  const bdt = p / PAISA_PER_BDT;
  return bdt.toFixed(2);
}

/**
 * Format BDT for display
 * @param paisa amount in paisa
 * @returns formatted string "৳2,500.00"
 */
export function format_bdt(paisa: number | bigint): string {
  const bdt = paisa_to_bdt(paisa);
  const parts = bdt.split('.');
  const integer_part = parseInt(parts[0], 10).toLocaleString('en-BD');
  return `৳${integer_part}.${parts[1]}`;
}

/**
 * Validate amount for transfer
 */
export function validate_amount(paisa: number): boolean {
  return (
    typeof paisa === 'number' &&
    paisa > 0 &&
    paisa <= MAX_TRANSFER &&
    Number.isInteger(paisa)
  );
}

// Example usage:
// bdt_to_paisa("2500.50") → 250050
// paisa_to_bdt(250050) → "2500.50"
// format_bdt(250050) → "৳2,500.50"
```

### 7.2 Validation Example

```typescript
// In controller
const { receiver_id, amount_bdt, note } = req.body;

const amount_paisa = bdt_to_paisa(amount_bdt);
if (!amount_paisa) {
  return res.status(422).json({
    error: { code: 'INVALID_AMOUNT', message: 'Amount must be positive with max 2 decimals' }
  });
}

// Now amount_paisa is safe to use (number, positive, integer)
```

---

## 8. MONEY TRANSFER IMPLEMENTATION

### 8.1 Transfer Service (Core Logic)

**File: `src/services/transfer.service.ts`**
```typescript
import { PoolClient } from 'pg';
import pool, { transaction } from '../config/database';
import { bdt_to_paisa, validate_amount, format_bdt } from '../utils/money';
import { v4 as uuidv4 } from 'uuid';

export class TransferService {
  /**
   * Execute a money transfer
   * This is the CORE FUNCTION - must be atomic and correct
   */
  static async transfer(params: {
    sender_id: string;
    receiver_id: string;
    amount_bdt: number;
    note?: string;
    idempotency_key: string;
  }): Promise<{
    transfer_id: string;
    status: string;
    amount_bdt: number;
    message: string;
  }> {
    const {
      sender_id,
      receiver_id,
      amount_bdt,
      note,
      idempotency_key
    } = params;

    // ============ PHASE 1: INPUT VALIDATION ============
    if (sender_id === receiver_id) {
      throw { code: 'SELF_TRANSFER_NOT_ALLOWED', status: 409 };
    }

    const amount_paisa = bdt_to_paisa(amount_bdt);
    if (!amount_paisa || !validate_amount(amount_paisa)) {
      throw { code: 'INVALID_AMOUNT', status: 422 };
    }

    if (note && note.length > 500) {
      throw { code: 'NOTE_TOO_LONG', status: 422 };
    }

    // ============ PHASE 2: IDEMPOTENCY CHECK ============
    const idempotency_result = await pool.query(
      `SELECT response_payload FROM idempotency_records
       WHERE user_id = $1 AND idempotency_key = $2 AND status = $3`,
      [sender_id, idempotency_key, 'COMPLETED']
    );

    if (idempotency_result.rows.length > 0) {
      // Key exists: return cached result
      return idempotency_result.rows[0].response_payload;
    }

    // ============ PHASE 3: PRE-FLIGHT CHECKS ============
    // Check sender balance
    const sender_balance_result = await pool.query(
      'SELECT balance_paisa FROM wallets WHERE user_id = $1 FOR UPDATE',
      [sender_id]
    );

    if (sender_balance_result.rows.length === 0) {
      throw { code: 'USER_NOT_FOUND', status: 404 };
    }

    const sender_balance = sender_balance_result.rows[0].balance_paisa;
    if (sender_balance < amount_paisa) {
      throw { code: 'INSUFFICIENT_BALANCE', status: 402 };
    }

    // Check receiver exists
    const receiver_result = await pool.query(
      'SELECT account_status FROM users WHERE id = $1',
      [receiver_id]
    );

    if (receiver_result.rows.length === 0) {
      throw { code: 'RECEIVER_NOT_FOUND', status: 404 };
    }

    if (receiver_result.rows[0].account_status !== 'ACTIVE') {
      throw { code: 'RECEIVER_INACTIVE', status: 409 };
    }

    // ============ PHASE 4: ATOMIC TRANSACTION ============
    const result = await transaction(async (client: PoolClient) => {
      const transfer_id = uuidv4();

      try {
        // Lock sender wallet
        const sender_lock = await client.query(
          'SELECT balance_paisa FROM wallets WHERE user_id = $1 FOR UPDATE NOWAIT',
          [sender_id]
        );

        if (sender_lock.rows.length === 0) {
          throw new Error('SENDER_NOT_FOUND');
        }

        const current_balance = sender_lock.rows[0].balance_paisa;
        if (current_balance < amount_paisa) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        // Debit sender
        await client.query(
          'UPDATE wallets SET balance_paisa = balance_paisa - $1, updated_at = NOW() WHERE user_id = $2',
          [amount_paisa, sender_id]
        );

        // Ledger entry: sender debit
        await client.query(
          `INSERT INTO ledger_entries (id, user_id, amount_paisa, transfer_id, entry_type, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [uuidv4(), sender_id, -amount_paisa, transfer_id, 'TRANSFER_DEBIT']
        );

        // Lock receiver wallet
        const receiver_lock = await client.query(
          'SELECT balance_paisa, user_id FROM wallets WHERE user_id = $1 FOR UPDATE NOWAIT',
          [receiver_id]
        );

        if (receiver_lock.rows.length === 0) {
          throw new Error('RECEIVER_NOT_FOUND');
        }

        // Credit receiver
        await client.query(
          'UPDATE wallets SET balance_paisa = balance_paisa + $1, updated_at = NOW() WHERE user_id = $2',
          [amount_paisa, receiver_id]
        );

        // Ledger entry: receiver credit
        await client.query(
          `INSERT INTO ledger_entries (id, user_id, amount_paisa, transfer_id, entry_type, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [uuidv4(), receiver_id, amount_paisa, transfer_id, 'TRANSFER_CREDIT']
        );

        // Create transfer record
        await client.query(
          `INSERT INTO transfers 
           (id, sender_id, receiver_id, amount_paisa, status, type, note, idempotency_key, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
          [transfer_id, sender_id, receiver_id, amount_paisa, 'COMPLETED', 'TRANSFER', note, idempotency_key]
        );

        // Cache idempotency result
        const response = {
          transfer_id,
          status: 'COMPLETED',
          amount_bdt: parseFloat(format_bdt(amount_paisa)),
          message: 'Transfer completed successfully'
        };

        await client.query(
          `INSERT INTO idempotency_records 
           (id, user_id, idempotency_key, request_payload, response_payload, status, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '24 hours')`,
          [uuidv4(), sender_id, idempotency_key, JSON.stringify(params), JSON.stringify(response), 'COMPLETED']
        );

        return response;
      } catch (err: any) {
        // Transaction will auto-rollback
        if (err.message === 'INSUFFICIENT_BALANCE') {
          throw { code: 'INSUFFICIENT_BALANCE', status: 402 };
        } else if (err.message === 'SENDER_NOT_FOUND') {
          throw { code: 'USER_NOT_FOUND', status: 404 };
        } else if (err.message === 'RECEIVER_NOT_FOUND') {
          throw { code: 'RECEIVER_NOT_FOUND', status: 404 };
        }
        throw err;
      }
    });

    // ============ PHASE 5: ASYNC NOTIFICATION ============
    // Queue notification (non-blocking)
    this.queueNotification(receiver_id, 'TRANSFER_RECEIVED', result.transfer_id, amount_bdt)
      .catch(err => console.error('Notification queue failed:', err));

    return result;
  }

  static async queueNotification(
    user_id: string,
    type: string,
    transfer_id: string,
    amount_bdt: number
  ): Promise<void> {
    // Queue to Redis or in-memory queue (for MVP, just log)
    console.log(`[NOTIFICATION] User ${user_id}: ${type} - ৳${amount_bdt}`);
    
    // For MVP: Insert into notifications table (async would be better)
    const message = `Received ৳${format_bdt(bdt_to_paisa(amount_bdt))} from sender`;
    await pool.query(
      `INSERT INTO notifications 
       (id, user_id, type, related_transfer_id, title, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [uuidv4(), user_id, type, transfer_id, `Received money`, message]
    );
  }

  static async getTransferStatus(
    transfer_id: string,
    user_id: string
  ): Promise<any> {
    const result = await pool.query(
      `SELECT id, sender_id, receiver_id, amount_paisa, status, note, created_at, updated_at, failure_reason
       FROM transfers
       WHERE id = $1 AND (sender_id = $2 OR receiver_id = $2)`,
      [transfer_id, user_id]
    );

    if (result.rows.length === 0) {
      throw { code: 'TRANSFER_NOT_FOUND', status: 404 };
    }

    const transfer = result.rows[0];
    return {
      transfer_id: transfer.id,
      status: transfer.status,
      sender_id: transfer.sender_id,
      receiver_id: transfer.receiver_id,
      amount_bdt: parseFloat(format_bdt(transfer.amount_paisa)),
      note: transfer.note,
      created_at: transfer.created_at,
      updated_at: transfer.updated_at,
      failure_reason: transfer.failure_reason
    };
  }
}
```

---

## 9. CONCURRENCY & TRANSACTION SAFETY

### 9.1 Database-Level Enforcement

**Key Implementation Details:**

1. **SERIALIZABLE Isolation**
   ```typescript
   // In transaction function
   await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
   ```
   - Strictest isolation level
   - Prevents all anomalies
   - Safe by design

2. **Row-Level Locking**
   ```sql
   SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE NOWAIT
   ```
   - `FOR UPDATE`: Acquires exclusive lock
   - `NOWAIT`: Fail fast if locked (don't wait)
   - Prevents concurrent balance updates

3. **Constraints Enforcement**
   ```sql
   ALTER TABLE wallets ADD CONSTRAINT balance_non_negative CHECK (balance_paisa >= 0);
   UNIQUE (sender_id, idempotency_key) -- Prevents duplicate idempotency keys
   ```
   - Database prevents invalid states
   - No code bugs can violate these

### 9.2 Concurrency Test

**File: `tests/concurrency/concurrent_transfers.test.ts`**
```typescript
import { TransferService } from '../../src/services/transfer.service';
import { bdt_to_paisa } from '../../src/utils/money';
import pool from '../../src/config/database';

describe('Concurrent Transfers (Race Conditions)', () => {
  it('should prevent overdraft with concurrent transfers', async () => {
    // Setup: User with ৳10,000
    const user_id = await createTestUser('concurrent@test.com', 1000000);
    const receiver1 = await createTestUser('receiver1@test.com', 0);
    const receiver2 = await createTestUser('receiver2@test.com', 0);

    // Attempt two concurrent transfers
    const promises = [
      TransferService.transfer({
        sender_id: user_id,
        receiver_id: receiver1,
        amount_bdt: 8000,
        idempotency_key: 'key-1-' + Date.now()
      }),
      TransferService.transfer({
        sender_id: user_id,
        receiver_id: receiver2,
        amount_bdt: 7000,
        idempotency_key: 'key-2-' + Date.now()
      })
    ];

    const results = await Promise.all(promises).catch(err => [
      { status: 'error', error: err },
      { status: 'error', error: err }
    ]);

    // One should succeed, one should fail
    const successes = results.filter((r: any) => r.status === 'COMPLETED');
    const failures = results.filter((r: any) => r.status === 'error');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Verify final balance
    const final_balance = await getBalance(user_id);
    expect(final_balance).toBe(200000); // ৳2,000 (only one transfer succeeded)
  });

  it('should handle 50 concurrent transfers safely', async () => {
    const user_id = await createTestUser('stress@test.com', 10000000); // ৳100,000
    const receivers = await Promise.all(
      Array.from({ length: 50 }).map(() => 
        createTestUser(`receiver-${Math.random()}@test.com`, 0)
      )
    );

    // Fire all 50 simultaneously
    const promises = receivers.map((receiver_id, i) =>
      TransferService.transfer({
        sender_id: user_id,
        receiver_id,
        amount_bdt: 2000,
        idempotency_key: `key-${i}-${Date.now()}`
      }).catch(err => ({ error: err }))
    );

    const results = await Promise.all(promises);

    // Exactly 50 should succeed
    const successes = results.filter((r: any) => !r.error && r.status === 'COMPLETED');
    expect(successes.length).toBe(50);

    // Final balance should be 0
    const final_balance = await getBalance(user_id);
    expect(final_balance).toBe(0);

    // Each receiver should have exactly ৳2,000
    for (const receiver_id of receivers) {
      const balance = await getBalance(receiver_id);
      expect(balance).toBe(200000);
    }
  });
});
```

---

## 10. IDEMPOTENCY

### 10.1 Idempotency Key Generation

**File: `src/utils/idempotency.ts`**
```typescript
import crypto from 'crypto';

/**
 * Generate idempotency key on client
 * Must be stored in browser sessionStorage
 */
export function generateIdempotencyKey(user_id: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  return `req-${user_id}-${timestamp}-${random}`;
}

/**
 * Validate idempotency key format
 */
export function validateIdempotencyKey(key: string): boolean {
  return /^req-.+-\d+-[a-f0-9]{16}$/.test(key);
}
```

### 10.2 Idempotency Middleware

**File: `src/middleware/idempotency.ts`**
```typescript
import { Request, Response, NextFunction } from 'express';
import { validateIdempotencyKey } from '../utils/idempotency';

export interface IdempotentRequest extends Request {
  idempotency_key?: string;
}

export function idempotencyMiddleware(
  req: IdempotentRequest,
  res: Response,
  next: NextFunction
) {
  // Only apply to mutations (POST, PUT, DELETE)
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
    return next();
  }

  const idempotency_key = req.headers['idempotency-key'] as string;

  if (!idempotency_key) {
    return res.status(400).json({
      error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header required' }
    });
  }

  if (!validateIdempotencyKey(idempotency_key)) {
    return res.status(400).json({
      error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Invalid Idempotency-Key format' }
    });
  }

  req.idempotency_key = idempotency_key;
  next();
}
```

### 10.3 Idempotency Check (in Service)

```typescript
// In transfer service (already shown above)
const idempotency_result = await pool.query(
  `SELECT response_payload FROM idempotency_records
   WHERE user_id = $1 AND idempotency_key = $2 AND status = $3`,
  [sender_id, idempotency_key, 'COMPLETED']
);

if (idempotency_result.rows.length > 0) {
  // Return cached result - no duplicate
  return idempotency_result.rows[0].response_payload;
}

// Proceed with execution...
```

### 10.4 Frontend Idempotency Storage

**File: `src/hooks/useIdempotentTransfer.ts`** (React)
```typescript
import { useCallback } from 'react';
import { generateIdempotencyKey } from '../utils/idempotency';

export function useIdempotentTransfer() {
  const executeTransfer = useCallback(async (
    receiver_id: string,
    amount_bdt: number,
    note?: string
  ) => {
    // Generate key
    const key = generateIdempotencyKey(user_id);
    
    // Store in sessionStorage
    sessionStorage.setItem(`transfer-${key}`, JSON.stringify({
      receiver_id,
      amount_bdt,
      timestamp: Date.now()
    }));

    try {
      // Make API call
      const response = await fetch('/transfers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ receiver_id, amount_bdt, note })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      // Clear sessionStorage
      sessionStorage.removeItem(`transfer-${key}`);
      
      return data;
    } catch (err) {
      // On network error, key remains in sessionStorage
      // User can retry, same key will be used
      throw err;
    }
  }, [user_id, token]);

  return { executeTransfer };
}
```

---

## 11. MONEY REQUEST IMPLEMENTATION

### 11.1 Money Request Service

**File: `src/services/request.service.ts`**
```typescript
import pool, { transaction } from '../config/database';
import { TransferService } from './transfer.service';
import { v4 as uuidv4 } from 'uuid';

export class RequestService {
  static async createRequest(params: {
    requester_id: string;
    requestee_id: string;
    amount_bdt: number;
    reason?: string;
  }): Promise<any> {
    const { requester_id, requestee_id, amount_bdt, reason } = params;

    // Validation
    if (requester_id === requestee_id) {
      throw { code: 'SELF_REQUEST_NOT_ALLOWED', status: 409 };
    }

    const amount_paisa = bdt_to_paisa(amount_bdt);
    if (!amount_paisa) {
      throw { code: 'INVALID_AMOUNT', status: 422 };
    }

    // Create request
    const request_id = uuidv4();
    const expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await pool.query(
      `INSERT INTO money_requests 
       (id, requester_id, requestee_id, amount_paisa, reason, status, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [request_id, requester_id, requestee_id, amount_paisa, reason, 'PENDING', expires_at]
    );

    // Queue notification
    this.queueNotification(
      requestee_id,
      'REQUEST_RECEIVED',
      request_id,
      amount_bdt,
      reason
    ).catch(err => console.error('Notification failed:', err));

    return {
      request_id,
      status: 'PENDING',
      amount_bdt,
      reason,
      created_at: new Date(),
      expires_at
    };
  }

  static async approveRequest(
    request_id: string,
    requestee_id: string
  ): Promise<any> {
    // Get request
    const result = await pool.query(
      `SELECT requester_id, requestee_id, amount_paisa, reason FROM money_requests
       WHERE id = $1 AND requestee_id = $2 AND status = $3`,
      [request_id, requestee_id, 'PENDING']
    );

    if (result.rows.length === 0) {
      throw { code: 'REQUEST_NOT_FOUND', status: 404 };
    }

    const request = result.rows[0];

    // Execute transfer (requestee sends to requester)
    const transfer_result = await TransferService.transfer({
      sender_id: requestee_id,
      receiver_id: request.requester_id,
      amount_bdt: paisa_to_bdt(request.amount_paisa),
      note: `Request approved: ${request.reason}`,
      idempotency_key: `req-approve-${request_id}-${Date.now()}`
    });

    // Update request status
    await pool.query(
      `UPDATE money_requests 
       SET status = $1, related_transfer_id = $2, updated_at = NOW()
       WHERE id = $3`,
      ['APPROVED', transfer_result.transfer_id, request_id]
    );

    // Notify requester
    this.queueNotification(
      request.requester_id,
      'REQUEST_APPROVED',
      request_id,
      paisa_to_bdt(request.amount_paisa),
      null
    ).catch(err => console.error('Notification failed:', err));

    return {
      request_id,
      status: 'APPROVED',
      transfer_id: transfer_result.transfer_id,
      amount_bdt: paisa_to_bdt(request.amount_paisa)
    };
  }

  static async rejectRequest(
    request_id: string,
    requestee_id: string
  ): Promise<any> {
    const result = await pool.query(
      `SELECT requester_id, amount_paisa FROM money_requests
       WHERE id = $1 AND requestee_id = $2 AND status = $3`,
      [request_id, requestee_id, 'PENDING']
    );

    if (result.rows.length === 0) {
      throw { code: 'REQUEST_NOT_FOUND', status: 404 };
    }

    const request = result.rows[0];

    // Update request status
    await pool.query(
      `UPDATE money_requests SET status = $1, updated_at = NOW() WHERE id = $2`,
      ['REJECTED', request_id]
    );

    // Notify requester
    this.queueNotification(
      request.requester_id,
      'REQUEST_REJECTED',
      request_id,
      paisa_to_bdt(request.amount_paisa),
      null
    ).catch(err => console.error('Notification failed:', err));

    return { request_id, status: 'REJECTED' };
  }

  static async cancelRequest(
    request_id: string,
    requester_id: string
  ): Promise<any> {
    const result = await pool.query(
      `SELECT requestee_id FROM money_requests
       WHERE id = $1 AND requester_id = $2 AND status = $3`,
      [request_id, requester_id, 'PENDING']
    );

    if (result.rows.length === 0) {
      throw { code: 'REQUEST_NOT_FOUND', status: 404 };
    }

    const request = result.rows[0];

    // Update status
    await pool.query(
      `UPDATE money_requests SET status = $1, updated_at = NOW() WHERE id = $2`,
      ['CANCELLED', request_id]
    );

    // Notify requestee
    this.queueNotification(
      request.requestee_id,
      'REQUEST_CANCELLED',
      request_id,
      null,
      null
    ).catch(err => console.error('Notification failed:', err));

    return { request_id, status: 'CANCELLED' };
  }

  static async getRequests(
    user_id: string,
    direction: 'received' | 'sent' | 'all' = 'all'
  ): Promise<any[]> {
    let query = `
      SELECT 
        id, 
        requester_id, 
        requestee_id,
        amount_paisa,
        reason,
        status,
        created_at,
        expires_at
      FROM money_requests
      WHERE (requester_id = $1 OR requestee_id = $1)
    `;

    if (direction === 'received') {
      query += ` AND requestee_id = $1`;
    } else if (direction === 'sent') {
      query += ` AND requester_id = $1`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, [user_id]);
    
    return result.rows.map(row => ({
      request_id: row.id,
      requester_id: row.requester_id,
      requestee_id: row.requestee_id,
      amount_bdt: paisa_to_bdt(row.amount_paisa),
      reason: row.reason,
      status: row.status,
      created_at: row.created_at,
      expires_at: row.expires_at
    }));
  }

  static async queueNotification(
    user_id: string,
    type: string,
    request_id: string,
    amount_bdt?: number | null,
    reason?: string | null
  ): Promise<void> {
    console.log(`[NOTIFICATION] User ${user_id}: ${type}`);
    
    let message = '';
    let title = '';
    
    if (type === 'REQUEST_RECEIVED') {
      title = 'Money Request Received';
      message = `${reason} requested ৳${format_bdt(bdt_to_paisa(amount_bdt!))}`;
    } else if (type === 'REQUEST_APPROVED') {
      title = 'Request Approved';
      message = `Your request for ৳${format_bdt(bdt_to_paisa(amount_bdt!))} was approved`;
    } else if (type === 'REQUEST_REJECTED') {
      title = 'Request Rejected';
      message = `Your request was rejected`;
    } else if (type === 'REQUEST_CANCELLED') {
      title = 'Request Cancelled';
      message = `A request has been cancelled`;
    }

    await pool.query(
      `INSERT INTO notifications 
       (id, user_id, type, related_request_id, title, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [uuidv4(), user_id, type, request_id, title, message]
    );
  }
}
```

---

## 12. API IMPLEMENTATION

### 12.1 API Routes Structure

**File: `src/routes/transfers.routes.ts`**
```typescript
import express from 'express';
import { authMiddleware } from '../middleware/auth';
import { idempotencyMiddleware } from '../middleware/idempotency';
import { TransferController } from '../controllers/transfer.controller';

const router = express.Router();

// POST /transfers - Create transfer
router.post(
  '/',
  authMiddleware,
  idempotencyMiddleware,
  TransferController.create
);

// GET /transfers/:id - Get transfer details
router.get(
  '/:id',
  authMiddleware,
  TransferController.getDetails
);

// GET /transfers - List user's transfers
router.get(
  '/',
  authMiddleware,
  TransferController.list
);

export default router;
```

**File: `src/controllers/transfer.controller.ts`**
```typescript
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { IdempotentRequest } from '../middleware/idempotency';
import { TransferService } from '../services/transfer.service';
import { bdt_to_paisa } from '../utils/money';

type TransferRequest = AuthenticatedRequest & IdempotentRequest;

export class TransferController {
  static async create(req: TransferRequest, res: Response) {
    try {
      const { receiver_id, amount_bdt, note } = req.body;
      const sender_id = req.user_id!;
      const idempotency_key = req.idempotency_key!;

      // Validate required fields
      if (!receiver_id || !amount_bdt) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'receiver_id and amount_bdt required' }
        });
      }

      // Execute transfer
      const result = await TransferService.transfer({
        sender_id,
        receiver_id,
        amount_bdt,
        note,
        idempotency_key
      });

      return res.status(202).json({
        success: true,
        data: result
      });
    } catch (err: any) {
      const status = err.status || 500;
      const code = err.code || 'INTERNAL_ERROR';
      return res.status(status).json({
        success: false,
        error: { code, message: err.message || 'Internal server error' }
      });
    }
  }

  static async getDetails(req: TransferRequest, res: Response) {
    try {
      const { id } = req.params;
      const user_id = req.user_id!;

      const result = await TransferService.getTransferStatus(id, user_id);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err: any) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: { code: err.code || 'ERROR', message: err.message }
      });
    }
  }

  static async list(req: TransferRequest, res: Response) {
    try {
      const user_id = req.user_id!;
      const { page = 1, limit = 20, type, status } = req.query;

      const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

      let query = `
        SELECT 
          t.id, t.sender_id, t.receiver_id, t.amount_paisa, t.status, 
          t.note, t.created_at, u.full_name
        FROM transfers t
        JOIN users u ON (
          CASE 
            WHEN t.sender_id = $1 THEN t.receiver_id = u.id
            WHEN t.receiver_id = $1 THEN t.sender_id = u.id
          END
        )
        WHERE t.sender_id = $1 OR t.receiver_id = $1
      `;

      const params: any[] = [user_id];

      if (status) {
        query += ` AND t.status = $${params.length + 1}`;
        params.push(status);
      }

      query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);

      return res.status(200).json({
        success: true,
        data: {
          transfers: result.rows,
          pagination: { page, limit, total: result.rows.length }
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: 'ERROR', message: err.message }
      });
    }
  }
}
```

### 12.2 Complete API Endpoints

```typescript
// AUTH ENDPOINTS
POST   /auth/register      → Register user
POST   /auth/login         → Login user
POST   /auth/logout        → Logout

// WALLET ENDPOINTS
GET    /wallet            → Get balance and info

// TRANSFER ENDPOINTS
POST   /transfers         → Create transfer (requires Idempotency-Key)
GET    /transfers/{id}    → Get transfer details
GET    /transfers         → List transfers (paginated)

// MONEY REQUEST ENDPOINTS
POST   /money-requests              → Create request
GET    /money-requests              → List requests
POST   /money-requests/{id}/approve → Approve request
POST   /money-requests/{id}/reject  → Reject request
DELETE /money-requests/{id}         → Cancel request

// TRANSACTION ENDPOINTS
GET    /transactions/{id}  → Get transaction details
GET    /transactions       → Get transaction history

// UTILITY ENDPOINTS
GET    /health            → Health check
GET    /users/search      → Search for users
```

---

## 13. ERROR HANDLING

### 13.1 Error Format

```typescript
// Success response
{
  "success": true,
  "data": { /* ... */ },
  "request_id": "req-20260829-1234567890"
}

// Error response
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {
      "field": "value" // optional
    }
  },
  "request_id": "req-20260829-1234567890"
}
```

### 13.2 Error Codes & Status Codes

```typescript
const ERROR_CODES = {
  // Auth
  'INVALID_CREDENTIALS': { status: 401 },
  'UNAUTHORIZED': { status: 401 },
  'MISSING_IDEMPOTENCY_KEY': { status: 400 },
  
  // Validation
  'INVALID_AMOUNT': { status: 422 },
  'INVALID_REQUEST': { status: 400 },
  'WEAK_PASSWORD': { status: 422 },
  
  // Business logic
  'INSUFFICIENT_BALANCE': { status: 402 },
  'SELF_TRANSFER_NOT_ALLOWED': { status: 409 },
  'USER_NOT_FOUND': { status: 404 },
  'RECEIVER_NOT_FOUND': { status: 404 },
  'RECEIVER_INACTIVE': { status: 409 },
  'EMAIL_ALREADY_REGISTERED': { status: 409 },
  'REQUEST_NOT_FOUND': { status: 404 },
  
  // Rate limiting
  'RATE_LIMITED': { status: 429 },
  
  // Server
  'INTERNAL_ERROR': { status: 500 },
  'DATABASE_ERROR': { status: 500 }
};
```

### 13.3 Global Error Handler

**File: `src/middleware/errorHandler.ts`**
```typescript
import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error('Error:', err);

  const request_id = req.headers['x-request-id'] || `req-${Date.now()}`;

  // If headers already sent
  if (res.headersSent) {
    return next(err);
  }

  // Default error
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';

  if (err.code && typeof err.status === 'number') {
    code = err.code;
    status = err.status;
    message = err.message || code;
  }

  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
      details: err.details || {}
    },
    request_id
  });
}
```

---

## 14. FRONTEND IMPLEMENTATION

### 14.1 Page: Login

**File: `src/pages/LoginPage.tsx`**
```typescript
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LoginForm from '../components/auth/LoginForm';
import { AuthService } from '../services/auth.service';

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await AuthService.login(email, password);
      
      // Store token
      localStorage.setItem('auth_token', result.token);
      localStorage.setItem('user_id', result.user_id);

      // Navigate to dashboard
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <h1>MoneyFlow Login</h1>
      {error && <div className="error-message">{error}</div>}
      <LoginForm onSubmit={handleLogin} loading={loading} />
    </div>
  );
}
```

### 14.2 Page: Send Money

**File: `src/pages/SendMoneyPage.tsx`**
```typescript
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import RecipientSearch from '../components/transfers/RecipientSearch';
import SendMoneyForm from '../components/transfers/SendMoneyForm';
import ConfirmationScreen from '../components/transfers/ConfirmationScreen';
import SuccessScreen from '../components/transfers/SuccessScreen';
import ErrorScreen from '../components/transfers/ErrorScreen';
import { TransferService } from '../services/transfer.service';
import { useAuth } from '../hooks/useAuth';

type Step = 'recipient' | 'amount' | 'confirm' | 'success' | 'error';

export function SendMoneyPage() {
  const { user_id, token } = useAuth();
  const navigate = useNavigate();
  
  const [step, setStep] = useState<Step>('recipient');
  const [recipient, setRecipient] = useState<any>(null);
  const [amount, setAmount] = useState<number>(0);
  const [note, setNote] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transfer_id, setTransferId] = useState<string | null>(null);

  const handleRecipientSelected = (selected: any) => {
    setRecipient(selected);
    setStep('amount');
  };

  const handleAmountEntered = (amt: number, n: string) => {
    setAmount(amt);
    setNote(n);
    setStep('confirm');
  };

  const handleConfirmed = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await TransferService.transfer(
        {
          receiver_id: recipient.user_id,
          amount_bdt: amount,
          note
        },
        token
      );

      setTransferId(result.transfer_id);
      setStep('success');

      // Auto-navigate after 3 seconds
      setTimeout(() => navigate('/dashboard'), 3000);
    } catch (err: any) {
      setError(err.message);
      setStep('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="send-money-container">
      {step === 'recipient' && (
        <RecipientSearch onSelect={handleRecipientSelected} />
      )}
      {step === 'amount' && (
        <SendMoneyForm 
          recipient={recipient}
          onNext={handleAmountEntered}
          loading={loading}
        />
      )}
      {step === 'confirm' && (
        <ConfirmationScreen
          recipient={recipient}
          amount={amount}
          note={note}
          onConfirm={handleConfirmed}
          onBack={() => setStep('amount')}
          loading={loading}
        />
      )}
      {step === 'success' && transfer_id && (
        <SuccessScreen
          transfer_id={transfer_id}
          amount={amount}
          recipient={recipient}
        />
      )}
      {step === 'error' && (
        <ErrorScreen
          error={error}
          onRetry={() => setStep('confirm')}
          onBack={() => navigate('/dashboard')}
        />
      )}
    </div>
  );
}
```

### 14.3 Component: Send Money Form

**File: `src/components/transfers/SendMoneyForm.tsx`**
```typescript
import React, { useState } from 'react';
import { formatBDT, validateAmount } from '../../utils/formatters';

interface SendMoneyFormProps {
  recipient: any;
  onNext: (amount: number, note: string) => void;
  loading: boolean;
}

export default function SendMoneyForm({ recipient, onNext, loading }: SendMoneyFormProps) {
  const [amount_input, setAmountInput] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amount = validateAmount(amount_input);
    if (!amount) {
      setError('Invalid amount. Use positive numbers with max 2 decimals.');
      return;
    }

    if (note.length > 500) {
      setError('Note cannot exceed 500 characters');
      return;
    }

    onNext(amount, note);
  };

  return (
    <form onSubmit={handleSubmit} className="send-money-form">
      <h2>Send Money to {recipient.full_name}</h2>

      <div className="form-group">
        <label>Amount (BDT)</label>
        <input
          type="text"
          placeholder="2500.00"
          value={amount_input}
          onChange={e => setAmountInput(e.target.value)}
          disabled={loading}
        />
        {amount_input && (
          <div className="preview">{formatBDT(parseInt(amount_input) * 100)}</div>
        )}
      </div>

      <div className="quick-presets">
        {[500, 1000, 2500, 5000].map(preset => (
          <button
            key={preset}
            type="button"
            onClick={() => setAmountInput(preset.toString())}
            disabled={loading}
          >
            ৳{preset}
          </button>
        ))}
      </div>

      <div className="form-group">
        <label>Note (optional)</label>
        <textarea
          placeholder="Lunch money"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={500}
          disabled={loading}
        />
        <small>{note.length}/500</small>
      </div>

      {error && <div className="error-message">{error}</div>}

      <button type="submit" disabled={loading || !amount_input}>
        {loading ? 'Processing...' : 'Continue'}
      </button>
    </form>
  );
}
```

---

## 15. TRANSACTION STATUS & RECOVERY

### 15.1 Transaction Status Polling

**File: `src/hooks/useTransactionStatus.ts`**
```typescript
import { useState, useEffect, useCallback } from 'react';
import { TransferService } from '../services/transfer.service';

interface TransactionStatus {
  transfer_id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  message: string;
  loading: boolean;
  error: string | null;
}

export function useTransactionStatus(transfer_id: string | null, token: string) {
  const [status, setStatus] = useState<TransactionStatus>({
    transfer_id: transfer_id || '',
    status: 'PROCESSING',
    message: 'Checking status...',
    loading: true,
    error: null
  });

  const checkStatus = useCallback(async () => {
    if (!transfer_id) return;

    try {
      const result = await TransferService.getStatus(transfer_id, token);
      
      setStatus(prev => ({
        ...prev,
        status: result.status,
        message: getStatusMessage(result.status),
        loading: false
      }));

      // Stop polling if terminal state
      if (result.status === 'COMPLETED' || result.status === 'FAILED') {
        return true; // Stop polling
      }
    } catch (err: any) {
      setStatus(prev => ({
        ...prev,
        error: err.message,
        loading: false
      }));
    }

    return false; // Continue polling
  }, [transfer_id, token]);

  useEffect(() => {
    if (!transfer_id) return;

    // Check immediately
    checkStatus();

    // Poll every 5 seconds for 2 minutes
    let poll_count = 0;
    const interval = setInterval(async () => {
      poll_count++;
      if (poll_count > 24) { // 24 * 5 = 120 seconds
        clearInterval(interval);
        return;
      }

      const done = await checkStatus();
      if (done) {
        clearInterval(interval);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [transfer_id, checkStatus]);

  return status;
}

function getStatusMessage(status: string): string {
  switch (status) {
    case 'COMPLETED': return '✓ Transfer completed successfully';
    case 'FAILED': return '✗ Transfer failed';
    case 'PENDING': return '⏳ Transfer is pending';
    case 'PROCESSING': return '⏳ Processing your transfer...';
    default: return 'Checking status...';
  }
}
```

### 15.2 Timeout Handling

```typescript
// Frontend: Handle network timeout gracefully
async function transferWithTimeout(
  receiver_id: string,
  amount_bdt: number,
  note: string,
  token: string
): Promise<any> {
  const timeout = 30000; // 30 seconds
  const controller = new AbortController();
  const timeout_id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch('/transfers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Idempotency-Key': generateKey(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ receiver_id, amount_bdt, note }),
      signal: controller.signal
    });

    clearTimeout(timeout_id);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (err: any) {
    clearTimeout(timeout_id);

    if (err.name === 'AbortError') {
      // Timeout: show "uncertain status" screen
      return {
        status: 'UNCERTAIN',
        message: 'Transfer status uncertain. Transaction ID: TXN-XXXX',
        action: 'CHECK_STATUS'
      };
    }

    throw err;
  }
}
```

---

## 16. NOTIFICATIONS

### 16.1 In-App Notifications

**File: `src/hooks/useNotifications.ts`**
```typescript
import { useState, useEffect } from 'react';
import { AuthenticatedRequest } from '../services/api';

export function useNotifications(user_id: string, token: string) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread_count, setUnreadCount] = useState(0);

  useEffect(() => {
    // Fetch notifications on mount
    fetchNotifications();

    // Poll for new notifications every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);

    return () => clearInterval(interval);
  }, [user_id, token]);

  const fetchNotifications = async () => {
    try {
      const response = await fetch('/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) return;

      const data = await response.json();
      setNotifications(data.data.notifications);
      setUnreadCount(data.data.notifications.filter((n: any) => !n.is_read).length);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  const markAsRead = async (notification_id: string) => {
    try {
      await fetch(`/notifications/${notification_id}/read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      fetchNotifications();
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  return { notifications, unread_count, markAsRead };
}
```

### 16.2 Notification Display Component

```typescript
export function NotificationCenter() {
  const { user_id, token } = useAuth();
  const { notifications, unread_count } = useNotifications(user_id, token);

  return (
    <div className="notification-center">
      <div className="notification-icon">
        🔔 {unread_count > 0 && <span className="badge">{unread_count}</span>}
      </div>

      <div className="notification-list">
        {notifications.map(notif => (
          <div key={notif.id} className="notification-item">
            <h4>{notif.title}</h4>
            <p>{notif.message}</p>
            <small>{formatTime(notif.created_at)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 17. SECURITY IMPLEMENTATION

### 17.1 Input Validation

**File: `src/utils/validators.ts`** (Backend)
```typescript
import Joi from 'joi';

export const registrationSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  full_name: Joi.string().min(1).max(255).required()
});

export const transferSchema = Joi.object({
  receiver_id: Joi.string().uuid().required(),
  amount_bdt: Joi.number().positive().precision(2).required(),
  note: Joi.string().max(500).optional()
});

export const moneyRequestSchema = Joi.object({
  requestee_id: Joi.string().uuid().required(),
  amount_bdt: Joi.number().positive().precision(2).required(),
  reason: Joi.string().max(200).optional()
});

// Validate input
export function validateInput(data: any, schema: Joi.Schema): { error?: any; value?: any } {
  return schema.validate(data);
}
```

### 17.2 Rate Limiting

**File: `src/middleware/rateLimit.ts`**
```typescript
import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: { count: number; reset_at: number };
}

const store: RateLimitStore = {};

export function rateLimit(max_requests: number, window_ms: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();

    if (!store[key]) {
      store[key] = { count: 0, reset_at: now + window_ms };
    }

    const { count, reset_at } = store[key];

    if (now > reset_at) {
      store[key] = { count: 1, reset_at: now + window_ms };
      return next();
    }

    if (count >= max_requests) {
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' }
      });
    }

    store[key].count++;
    res.set('X-RateLimit-Remaining', String(max_requests - count - 1));
    res.set('X-RateLimit-Reset', String(reset_at));

    next();
  };
}

// Use in routes:
// router.post('/transfers', rateLimit(10, 60000), ...); // 10 per minute
```

### 17.3 HTTPS & Secure Headers

```typescript
// In Express setup (app.ts)
import helmet from 'helmet';

app.use(helmet()); // Security headers

// Enforce HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (!req.secure) {
      return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
  });
}
```

---

## 18. OBSERVABILITY

### 18.1 Structured Logging

**File: `src/utils/logger.ts`**
```typescript
interface LogContext {
  request_id?: string;
  user_id?: string;
  transfer_id?: string;
  [key: string]: any;
}

export class Logger {
  static info(message: string, context?: LogContext) {
    console.log(JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      message,
      ...context
    }));
  }

  static error(message: string, err?: any, context?: LogContext) {
    console.error(JSON.stringify({
      level: 'ERROR',
      timestamp: new Date().toISOString(),
      message,
      error: err?.message,
      stack: err?.stack,
      ...context
    }));
  }

  static warn(message: string, context?: LogContext) {
    console.warn(JSON.stringify({
      level: 'WARN',
      timestamp: new Date().toISOString(),
      message,
      ...context
    }));
  }
}

// Usage
Logger.info('Transfer created', {
  request_id: 'req-123',
  transfer_id: 'TXN-456',
  user_id: 'user-789',
  amount_paisa: 250000
});
```

### 18.2 Request ID Middleware

```typescript
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const request_id = req.headers['x-request-id'] as string || uuidv4();
  
  (req as any).request_id = request_id;
  res.setHeader('X-Request-ID', request_id);
  
  next();
}
```

### 18.3 Health Check Endpoint

```typescript
// GET /health
router.get('/health', async (req, res) => {
  try {
    // Check database
    const db_result = await pool.query('SELECT 1');
    
    res.status(200).json({
      status: 'healthy',
      database: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'error',
      error: err
    });
  }
});
```

---

## 19. TESTING

### 19.1 Unit Tests Example

**File: `tests/unit/money.test.ts`**
```typescript
import { bdt_to_paisa, paisa_to_bdt, validate_amount } from '../../src/utils/money';

describe('Money Utilities', () => {
  test('should convert BDT to paisa correctly', () => {
    expect(bdt_to_paisa('2500')).toBe(250000);
    expect(bdt_to_paisa('2500.50')).toBe(250050);
    expect(bdt_to_paisa('0.01')).toBe(1);
  });

  test('should reject invalid amounts', () => {
    expect(bdt_to_paisa('2500.555')).toBeNull(); // Too many decimals
    expect(bdt_to_paisa('-100')).toBeNull(); // Negative
    expect(bdt_to_paisa('0')).toBeNull(); // Zero
    expect(bdt_to_paisa('abc')).toBeNull(); // Invalid
  });

  test('should convert paisa to BDT correctly', () => {
    expect(paisa_to_bdt(250000)).toBe('2500.00');
    expect(paisa_to_bdt(250050)).toBe('2500.50');
    expect(paisa_to_bdt(1)).toBe('0.01');
  });

  test('should validate amounts correctly', () => {
    expect(validate_amount(250000)).toBe(true);
    expect(validate_amount(-250000)).toBe(false);
    expect(validate_amount(0)).toBe(false);
    expect(validate_amount(250000.5)).toBe(false); // Not integer
  });
});
```

### 19.2 Integration Test Example

**File: `tests/integration/transfer.integration.test.ts`**
```typescript
import { TransferService } from '../../src/services/transfer.service';
import { setupTestDatabase } from '../setup';

describe('Transfer Integration', () => {
  let sender_id: string;
  let receiver_id: string;

  beforeAll(async () => {
    await setupTestDatabase();
    sender_id = await createTestUser('sender@test.com', 50000000); // ৳500,000
    receiver_id = await createTestUser('receiver@test.com', 20000000); // ৳200,000
  });

  test('should execute successful transfer', async () => {
    const result = await TransferService.transfer({
      sender_id,
      receiver_id,
      amount_bdt: 2500,
      note: 'Test transfer',
      idempotency_key: `key-${Date.now()}`
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.transfer_id).toBeDefined();
    expect(result.amount_bdt).toBe(2500);

    // Verify balances
    const sender_balance = await getBalance(sender_id);
    const receiver_balance = await getBalance(receiver_id);

    expect(sender_balance).toBe(47500000);
    expect(receiver_balance).toBe(22500000);
  });

  test('should reject transfer with insufficient balance', async () => {
    const poor_user = await createTestUser('poor@test.com', 1000000);

    const error = await TransferService.transfer({
      sender_id: poor_user,
      receiver_id,
      amount_bdt: 2500,
      idempotency_key: `key-${Date.now()}`
    }).catch(e => e);

    expect(error.code).toBe('INSUFFICIENT_BALANCE');
    expect(error.status).toBe(402);
  });

  test('should prevent duplicate transfer via idempotency', async () => {
    const key = `key-idempotent-${Date.now()}`;

    const result1 = await TransferService.transfer({
      sender_id,
      receiver_id,
      amount_bdt: 100,
      idempotency_key: key
    });

    // Same key, same request
    const result2 = await TransferService.transfer({
      sender_id,
      receiver_id,
      amount_bdt: 100,
      idempotency_key: key
    });

    expect(result1.transfer_id).toBe(result2.transfer_id);
    expect(result1.status).toBe(result2.status);
  });
});
```

### 19.3 Test Setup

**File: `tests/setup.ts`**
```typescript
import pool from '../src/config/database';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

export async function setupTestDatabase() {
  // Create tables (use same migrations as production)
  // ...
}

export async function createTestUser(
  email: string,
  balance_paisa: number = 10000000
): Promise<string> {
  const user_id = uuidv4();
  const password_hash = await bcrypt.hash('TestPass123', 10);

  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
    [user_id, email, password_hash, 'Test User']
  );

  await pool.query(
    `INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, $2)`,
    [user_id, balance_paisa]
  );

  return user_id;
}

export async function getBalance(user_id: string): Promise<number> {
  const result = await pool.query(
    'SELECT balance_paisa FROM wallets WHERE user_id = $1',
    [user_id]
  );
  return result.rows[0]?.balance_paisa || 0;
}

export async function teardownTestDatabase() {
  // Clean up test data
  await pool.query('DELETE FROM transfers');
  await pool.query('DELETE FROM ledger_entries');
  await pool.query('DELETE FROM money_requests');
  await pool.query('DELETE FROM wallets');
  await pool.query('DELETE FROM users');
}
```

---

## 20. DEPLOYMENT

### 20.1 Docker Setup

**File: `Dockerfile`**
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY . .

# Compile TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start
CMD ["node", "dist/app.js"]
```

**File: `docker-compose.yml`**
```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://moneyflow:password@db:5432/moneyflow
      NODE_ENV: development
      JWT_SECRET: dev-secret-key-min-32-chars
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./src:/app/src

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: moneyflow
      POSTGRES_PASSWORD: password
      POSTGRES_DB: moneyflow
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U moneyflow"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### 20.2 Environment Setup

```bash
# .env.development
DATABASE_URL=postgresql://moneyflow:password@localhost:5432/moneyflow
NODE_ENV=development
PORT=3000
JWT_SECRET=dev-secret-key-change-in-production
REACT_APP_API_URL=http://localhost:3000

# .env.production
DATABASE_URL=postgresql://user:pass@prod-db:5432/moneyflow
NODE_ENV=production
PORT=3000
JWT_SECRET=<strong-random-key>
API_URL=https://api.moneyflow.app
REACT_APP_API_URL=https://api.moneyflow.app
```

### 20.3 Local Development Setup

```bash
# 1. Clone repo
git clone https://github.com/team/moneyflow.git
cd moneyflow

# 2. Copy environment
cp .env.example .env

# 3. Start services
docker-compose up -d

# 4. Verify database is ready (wait 10 seconds)
sleep 10

# 5. Run migrations
npm run migrate

# 6. Seed test data
npm run seed

# 7. Start dev server
npm run dev

# 8. Frontend (separate terminal)
cd frontend
npm install
npm start

# Application ready at http://localhost:3000
```

---

## 21. IMPLEMENTATION CHECKLIST

### P0 — ABSOLUTELY REQUIRED (MVP)

**Authentication:**
- [ ] User registration endpoint (email, password, name)
- [ ] User login endpoint
- [ ] JWT token generation and validation
- [ ] Password hashing (bcrypt)
- [ ] Initial balance (৳100,000) on registration

**Wallet & Balance:**
- [ ] Wallet table with BIGINT balance
- [ ] Get balance endpoint
- [ ] Balance displays correctly in UI

**Money Transfer (Core):**
- [ ] Transfer request endpoint (POST /transfers)
- [ ] Database transaction with SERIALIZABLE isolation
- [ ] Row-level wallet locking
- [ ] Balance verification (pre-flight)
- [ ] Atomic debit/credit operation
- [ ] Ledger entries (immutable log)
- [ ] Transfer status tracking (COMPLETED/FAILED)
- [ ] Unique transfer ID generation
- [ ] Transfer details endpoint (GET /transfers/{id})
- [ ] Transfer list endpoint (GET /transfers)

**Idempotency (Critical):**
- [ ] Idempotency key validation
- [ ] Idempotency records table
- [ ] Duplicate request detection
- [ ] Cached response return

**Transaction History:**
- [ ] Transaction history query
- [ ] Pagination support
- [ ] Filtering by type/status
- [ ] UI display of history

**Frontend (MVP):**
- [ ] Login page
- [ ] Registration page
- [ ] Dashboard (balance display)
- [ ] Send money flow (recipient → amount → confirm → success)
- [ ] Transaction history page
- [ ] Transaction details page
- [ ] Error message display
- [ ] Loading states

**Error Handling:**
- [ ] Standardized error responses
- [ ] HTTP status codes (400, 401, 402, 404, 409, 422, 500)
- [ ] Clear error messages to users
- [ ] Error codes (INSUFFICIENT_BALANCE, USER_NOT_FOUND, etc.)

**Testing:**
- [ ] Unit tests for money conversion
- [ ] Unit tests for validation
- [ ] Integration test for transfer API
- [ ] Concurrency test (50 simultaneous transfers)
- [ ] Idempotency test (duplicate detection)

**Deployment:**
- [ ] Docker setup
- [ ] Docker Compose
- [ ] Environment variables configured
- [ ] Database migrations
- [ ] Health check endpoint
- [ ] Local setup instructions

### P1 — IMPORTANT

**Money Requests:**
- [ ] Create money request endpoint
- [ ] List requests endpoint (received/sent)
- [ ] Approve request endpoint (executes transfer)
- [ ] Reject request endpoint
- [ ] Cancel request endpoint
- [ ] Request status tracking
- [ ] Request UI pages
- [ ] Request notifications

**Notifications:**
- [ ] Create notifications table
- [ ] In-app notification retrieval
- [ ] Notification marking as read
- [ ] Notification display in UI
- [ ] Notification for received transfer
- [ ] Notification for money request

**UI/UX Polish:**
- [ ] Responsive design (mobile + desktop)
- [ ] Loading spinners
- [ ] Confirmation dialogs
- [ ] Success/error screens
- [ ] Duplicate action prevention
- [ ] Form validation feedback

**Observability:**
- [ ] Structured logging
- [ ] Request ID tracking
- [ ] Transfer ID tracking
- [ ] Health check endpoint

---

## 22. QUICK START COMMAND

```bash
# Install dependencies
npm install

# Setup database
npm run migrate
npm run seed

# Start development
npm run dev

# In another terminal, start frontend
cd frontend && npm install && npm start

# Run tests
npm test

# Build for production
npm run build

# Start production
npm start
```

---

## 23. KEY IMPLEMENTATION REMINDERS

1. **Money is ALWAYS integer paisa**, never floating-point BDT
2. **Transactions are ALWAYS atomic** (all-or-nothing)
3. **Balances are ALWAYS locked** during transfers
4. **Idempotency keys ALWAYS prevent duplicates**
5. **Ledger entries are ALWAYS immutable**
6. **Transfer IDs are ALWAYS unique**
7. **Errors are ALWAYS clear** (not "something went wrong")
8. **Database constraints are ALWAYS checked** (defense in depth)
9. **Concurrent transfers are ALWAYS serialized** (one at a time per wallet)
10. **Network timeouts ALWAYS allow status checking** (definitive later answer)

---

**This implementation guide is your step-by-step recipe.** Follow it, test as you go, and you'll have a production-quality money movement system in 6 hours.

**Good luck! 🚀**
