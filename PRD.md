# PRODUCT REQUIREMENTS DOCUMENT
## Money Movement Application
### PSTU IT Carnival 2026 Hackathon Challenge

**Document Version:** 1.0  
**Date:** 29 August 2026  
**Status:** Implementation Ready  
**Target Duration:** 9:00 AM - 3:00 PM (6 hours hackathon sprint)

---

## EXECUTIVE SUMMARY

This PRD defines a **digital money movement platform** that allows users to securely transfer money, request funds, and maintain a trustworthy transaction history within a closed ecosystem.

**Core Thesis:** *Moving money is not a simple database update. It is a correctness, concurrency, and trust problem.*

The application demonstrates production-grade thinking around:
- **Atomic transactions** preventing partial updates
- **Concurrency safety** under simultaneous high-volume transfers
- **Idempotency** against duplicate and retry requests
- **Transaction correctness** maintaining system invariants
- **Failure resilience** enabling transaction recovery
- **Audit capability** for all money movement

This PRD prioritizes a **small, polished, technically defensible MVP** over feature breadth.

---

## 1. PRODUCT OVERVIEW

### Product Name
**MoneyFlow** — A secure, reliable digital money movement platform.

### One-Line Description
A Bangladeshi-context digital wallet application enabling peer-to-peer money transfers, money requests, and transaction history with production-grade transaction correctness and concurrency safety.

### Product Vision
Enable a trusted community where money can move between users with absolute certainty that transactions are correct, atomic, and never duplicated—even under high concurrency, network failures, or unexpected load.

### Product Mission
1. **Reliability:** Every transaction completes correctly or fails safely.
2. **Correctness:** Money is never duplicated, lost, or partially transferred.
3. **Trust:** Users understand exactly what happened and can verify any transaction.
4. **Scalability:** Architecture supports growth from 100K to 10M+ users without sacrificing correctness.
5. **Resilience:** System recovers from network failures, crashes, and unexpected errors.

### Core Value Proposition
**For Users:**
- Simple, intuitive money transfer and request interface
- Complete transaction transparency with unique IDs
- Confidence that sent money actually arrives (no double-spending)
- Clear status for every transaction

**For Engineers/Operators:**
- Production-ready transaction engine with idempotency and atomicity
- Observable system with traceable transactions
- Architecture designed for horizontal scaling
- Defensive against concurrency bugs and race conditions

### Why This is More Than a CRUD Money-Transfer App

A naive implementation might be:
```
function transfer(sender_id, receiver_id, amount):
  user[sender_id].balance -= amount
  user[receiver_id].balance += amount
```

**This fails catastrophically:**
1. **No atomicity:** If it crashes between lines, money disappears.
2. **Race condition:** Two simultaneous transfers can overdraw.
3. **No idempotency:** Double-click sends money twice.
4. **No auditability:** No proof what happened or when.
5. **No recovery:** No way to know final state after timeout.
6. **No trust:** Users can't verify transactions.

**MoneyFlow solves these** with:
- Transaction state machine (PENDING → PROCESSING → COMPLETED/FAILED)
- Database-level constraints preventing overdraft
- Idempotency keys preventing duplicate execution
- Immutable ledger entries for every movement
- Transaction IDs for traceability
- Atomic database transactions
- Concurrency control (row-level locking)
- Comprehensive transaction history
- Clear, actionable transaction status in UI

---

## 2. PROBLEM STATEMENT

### The Challenge
Design and develop a Money Movement Application that allows users to transfer/request money between one another through digital accounts (with fake balance), designed as a **real-world environment** where transactions must be **correct, reliable, and trustworthy**.

### The User Problem
People in a growing community need to:
- **Send money:** "I need to send ৳2,500 to another user."
- **Request money:** "My friend owes me ৳1,200. I want to collect it."
- **Know status:** "Did my transfer succeed? Where's my money?"
- **Trust the system:** "I need confidence that sent money actually arrives, not gets lost or duplicated."

### The Engineering Problem
Money movement appears simple in isolation:
```
A → ৳500 → B
```

But real systems face:

**Concurrency:**
- User A clicks "Send ৳6,000"
- User B clicks "Send ৳7,000" (simultaneously)
- Available balance: ৳10,000
- Result must be: one succeeds, one fails (correct). NOT: both succeed with negative balance (disaster).

**Network Unreliability:**
- Request timeout: Did it process or not?
- Retry: Will the same amount transfer twice?
- Crash: What state is the transaction in?

**Duplicate Requests:**
- Double-click send button
- Browser auto-retry
- API retry on timeout
- Same transaction must not execute twice

**Scale:**
- 100 users: simple, sequential
- 1M users: concurrent requests spike during payday
- 10M users: potential simultaneous transfers during Eid Salami bonus distributions
- System must maintain correctness at any scale

**User Expectations:**
- "Is my money sent?" → needs definitive answer
- "Where is my money?" → needs transaction history
- "Why did it fail?" → needs clear, actionable reason
- "How do I prevent accidents?" → needs confirmation UX

### Why Simple Balance Updates Fail

| Issue | Naive Approach | MoneyFlow Solution |
|-------|----------------|-------------------|
| **Partial failure** | Money disappears if crash mid-update | Atomic transaction: all-or-nothing |
| **Race conditions** | Two withdrawals from ৳10K → ৳-3K balance | Row locking + database constraints |
| **Duplicates** | Same transfer twice if double-click/retry | Idempotency key prevents re-execution |
| **Uncertainty** | User doesn't know if transfer succeeded | Transaction status + unique ID |
| **Auditability** | No record how balance changed | Immutable ledger entries + history |
| **Scale** | Sequential balance updates → bottleneck | Partition by user + event-driven notifications |

### Reliability Challenges
- Backend crashes mid-transaction
- Database connection fails
- Notification service unreachable
- User requests status after timeout
- Multiple retries arriving simultaneously

### Concurrency Challenges
- Spike load during salary payment day
- 50,000+ simultaneous transfers in seconds
- Database must serialize without deadlock
- Each transaction must maintain invariants

### Trust Challenges
- Users must understand what happened
- No mysterious "something went wrong" messages
- Transaction history must be verifiable
- Sender and receiver must see consistent state

### Scalability Challenges
- Architecture must support horizontal backend scaling
- Database must not become bottleneck
- Indexes must support fast queries at scale
- Connection pooling essential
- Future: sharding by user_id for 10M+ users

---

## 3. PRODUCT GOALS

### Primary Goals (MVP Focus)

1. **Reliable Money Transfer**
   - User A sends ৳X to User B
   - Amount deducted from A exactly once
   - Amount credited to B exactly once
   - Sender and receiver both see consistent state

2. **Money Request Workflow**
   - User A requests ৳X from User B
   - User B sees pending request
   - User B approves/rejects
   - Approved requests execute as transfers

3. **Transaction Correctness**
   - No money created/destroyed
   - No overdrafts
   - No partial transfers
   - All system invariants maintained

4. **Trustworthy Transaction History**
   - Every completed transfer logged
   - Each transaction has unique ID
   - Clear status (PENDING/COMPLETED/FAILED)
   - Timestamps and all details retained

5. **Secure Account Access**
   - Password-protected accounts
   - Session management
   - Proper authentication/authorization
   - Account balance reflects true state

6. **Resilient Backend Behavior**
   - Recovers from network failures
   - Handles duplicate requests safely
   - Provides clear failure reasons
   - Maintains data consistency always

### Secondary Goals

1. **User Experience**
   - Intuitive send/request flow
   - Fast feedback on actions
   - Clear transaction status
   - Mobile-friendly interface

2. **Operational Visibility**
   - System logs for debugging
   - Transaction traceability
   - Error categorization
   - Performance metrics

3. **Foundation for Scale**
   - Stateless backend services
   - Database indexes for fast queries
   - Connection pooling
   - Event-driven architecture ready for async notifications

### Non-Goals (Explicitly Out of Scope)

1. **NOT a banking platform**
   - No KYC/AML
   - No regulatory compliance
   - No interest calculations
   - No loan products

2. **NOT integrated with real systems**
   - No real bank connections
   - No card processing
   - No payment gateway integration
   - No real financial networks

3. **NOT a bKash competitor (for MVP)**
   - No merchant payments
   - No bill pay
   - No utility payments
   - No top-up services
   - *Note: Architecture designed for future expansion*

4. **NOT a feature-rich application**
   - No advanced fraud detection
   - No scheduled transfers (future)
   - No recurring payments (future)
   - No peer grouping/splitting (future)
   - No QR code payments (future)
   - No favorites/contacts (future)

---

## 4. TARGET USERS

### User Persona 1: Individual Sender
**Name:** Rana Ahmed  
**Context:** Daily user of digital wallets  
**Need:** Send money to family, friends, colleagues reliably  
**Pain Point:** Uncertainty about whether transfer succeeded if network is slow  
**Goals:**
- Quick, simple transfer process
- Confidence money arrives
- Receipt/proof for sender

### User Persona 2: Individual Receiver
**Name:** Fatima Khan  
**Context:** Receives money from multiple sources  
**Need:** Know when money arrives, from whom, and why  
**Pain Point:** Unclear transaction details, confusion about balances  
**Goals:**
- Clear notification on receipt
- Transaction history
- Understanding of balance changes

### User Persona 3: Money Requester
**Name:** Arjun Roy  
**Context:** Needs to collect money from friends/colleagues  
**Need:** Request money without awkward repeated asks  
**Pain Point:** Hard to track who owes what, forgotten requests  
**Goals:**
- Send request
- Track pending requests
- Receive approval notification

### User Persona 4: Skeptical First-Timer
**Name:** Nasrin Begum  
**Context:** New to digital money movement  
**Need:** Understand what's happening with her money  
**Pain Point:** Skeptical of digital systems, fears money loss  
**Goals:**
- See clear transaction status
- Understand each step
- Verify receipt in transaction history

### System Administrator / Operator (Limited Scope)
**Name:** Engineering Team  
**Role:** Monitor system health, debug issues  
**Powers:** 
- View transaction history (audit)
- Check account balance states
- Read system logs
- **NOT:** Modify transactions, reverse transfers, override invariants
**Rationale:** Administrative powers that can modify money violate transaction trust.

---

## 5. CORE USER STORIES

### Authentication & Account Management

**US-1: User Registration**
```gherkin
Given I am a new user
When I click "Register"
And I provide email, password, full name
Then my account is created
And I am credited with BDT 100,000 initial balance
And I can immediately log in
```

**US-2: User Login**
```gherkin
Given I am a registered user
When I provide email and password
Then I receive an authentication token
And I can access my wallet
```

**US-3: View Account Profile**
```gherkin
Given I am logged in
When I navigate to Profile
Then I see my name, email, account creation date
And I can update my password
```

### Wallet Management

**US-4: Check Current Balance**
```gherkin
Given I am logged in
When I open Dashboard
Then I see my current available balance
And the amount is updated to reflect all completed transactions
```

**US-5: View Initial Balance**
```gherkin
Given I am a newly registered user
When I check my wallet
Then I have BDT 100,000 available
And I see transaction history showing the initial funding
```

### Money Transfer

**US-6: Send Money to Another User**
```gherkin
Given I am logged in with balance ≥ BDT 2,500
When I click "Send Money"
And I search/select recipient "Fatima Khan"
And I enter amount: ৳2,500
And I add optional note: "Lunch money"
And I click "Confirm"
Then my balance decreases by ৳2,500
And Fatima's balance increases by ৳2,500
And both of us see transaction in our history
And I receive a transaction ID: TXN-XXXXXXXXXXXX
And Fatima receives a notification
```

**US-7: Cannot Send to Self**
```gherkin
Given I am logged in
When I attempt to send money to my own account
Then the system shows error: "Cannot send money to yourself"
And no transaction is created
```

**US-8: Cannot Send Negative Amount**
```gherkin
Given I am logged in
When I attempt to send ৳-500 or ৳0
Then the system shows error: "Amount must be positive"
And no transaction is created
```

**US-9: Cannot Send with Insufficient Balance**
```gherkin
Given I have balance of ৳1,000
When I attempt to send ৳2,500
Then the system shows error: "Insufficient balance"
And my balance remains ৳1,000
And no transaction is created
```

**US-10: Send Money to Non-Existent User**
```gherkin
Given I am logged in
When I search for recipient "NonExistent User"
Then no results appear
And I cannot proceed with transfer
```

**US-11: Duplicate Click Prevention**
```gherkin
Given I am on the confirmation screen
When I click "Send" twice rapidly
Then only one transfer executes
And I see a message: "Transfer already in progress"
```

**US-12: Network Timeout Handling**
```gherkin
Given I clicked "Send" and network dropped
When I return to the app after 2 minutes
And I check my balance and transaction history
Then the system shows definitive state: COMPLETED or FAILED
And I can see unique transaction ID if completed
And my balance is consistent with history
```

### Money Requests

**US-13: Request Money from Another User**
```gherkin
Given I am logged in
When I click "Request Money"
And I search for "Arjun Roy"
And I enter amount: ৳1,200
And I add reason: "Lunch you bought for me"
And I click "Send Request"
Then Arjun receives a notification
And I see pending request in my "Requests Sent"
And Arjun can see it in his "Requests Received"
```

**US-14: View Pending Requests**
```gherkin
Given I am logged in
When I navigate to "Money Requests"
Then I see two tabs: "Sent" and "Received"
And each shows all pending requests with requester/requestee, amount, reason, timestamp
```

**US-15: Approve Money Request**
```gherkin
Given I have received a request from "Rana" for ৳1,200
When I click "Approve"
Then if I have balance ≥ ৳1,200:
  - Transfer executes (same as normal send)
  - Request marked as APPROVED
  - Rana receives notification: "Request approved"
  - Transaction appears in both histories
Else:
  - I see error: "Insufficient balance to approve"
  - Request remains pending
```

**US-16: Reject Money Request**
```gherkin
Given I have received a request from "Rana" for ৳1,200
When I click "Reject"
Then request is marked as REJECTED
And Rana receives notification: "Request rejected"
And no transfer occurs
```

**US-17: Cancel Sent Request**
```gherkin
Given I sent a request to "Arjun" that's still pending
When I click "Cancel"
Then request is marked as CANCELLED
And Arjun's "Requests Received" updates
```

### Transaction History

**US-18: View Complete Transaction History**
```gherkin
Given I am logged in
When I click "Transaction History"
Then I see all my transactions in reverse chronological order:
  - Transfers I sent (with "SENT" badge)
  - Transfers I received (with "RECEIVED" badge)
  - Money requests sent/received (with status)
And each shows:
  - Unique transaction ID
  - Other party (sender/receiver/requester)
  - Amount
  - Status (COMPLETED/FAILED/PENDING/APPROVED/REJECTED)
  - Timestamp
  - Optional note/reason
```

**US-19: View Transaction Details**
```gherkin
Given I see a transaction in my history
When I click on it
Then I see full details:
  - Transaction ID (unique, copyable)
  - Type (TRANSFER / REQUEST)
  - Direction (SENT / RECEIVED / REQUESTED / REQUEST_FROM)
  - Amount
  - Full name of other party
  - Status (clear description)
  - Exact timestamp
  - Note / reason (if any)
  - My balance before transaction
  - My balance after transaction
```

**US-20: Filter Transaction History**
```gherkin
Given I am viewing transaction history
When I use the filter options:
  - Date range
  - Type (Send/Receive/Request)
  - Status
Then history is filtered to show only matching transactions
```

### Transaction Status & Clarity

**US-21: Transaction Status After Send**
```gherkin
Given I clicked "Send" and received confirmation
Then I see:
  - Status: "COMPLETED" (or appropriate status)
  - Transaction ID: TXN-20260829-XXXXX
  - "This transfer has been successfully sent to [Receiver Name]"
  - Balance updated
  - Option to view transaction details
```

**US-22: Transaction Status on Refresh**
```gherkin
Given I sent a transfer and network is uncertain
When I close the app and reopen after 1 minute
And I navigate to Transaction History
Then I can see definitively whether transfer COMPLETED or FAILED
And balance is consistent
```

**US-23: Clear Failure Messages**
```gherkin
Given a transaction failed
When I view the transaction
Then I see clear, actionable error:
  - NOT: "Something went wrong"
  - INSTEAD: "Insufficient balance" or "Recipient account not found"
           or "Network timeout, retry transfer"
```

### Notifications

**US-24: Receive Transfer Notification**
```gherkin
Given I received a transfer from Rana
When transaction completes
Then I see notification:
  - Alert: "Received ৳2,500 from Rana Ahmed"
  - Timestamp
  - Ability to view transaction details
```

**US-25: Receive Request Notification**
```gherkin
Given Arjun sent me a money request
When request reaches system
Then I see notification:
  - "Arjun Roy requested ৳1,200"
  - Reason: "Lunch"
  - Quick approve/reject buttons (optional)
```

**US-26: Notification on Approval/Rejection**
```gherkin
Given I approved/rejected a request
When action completes
Then requester receives notification:
  - "Rana approved your ৳1,200 request"
  - or "Rana rejected your ৳1,200 request"
```

---

## 6. CORE FEATURES

### Feature 1: Authentication System

**Registration:**
- Email and password input
- Password strength validation (minimum 8 characters, complexity optional)
- Password hashing (bcrypt minimum)
- Email uniqueness validation
- Initial balance: BDT 100,000 (paisa representation: 10000000)
- Default account status: ACTIVE

**Login:**
- Email + password authentication
- JWT token generation on success
- Token expiration: 24 hours (hackathon scope; production would use shorter TTL)
- Optional: refresh tokens for better security
- Session invalidation on logout
- Brute-force protection (rate limiting after 5 failed attempts)

**Session Management:**
- Stateless JWT-based authentication
- Token stored in HTTP-only cookie or secure localStorage
- Automatic logout after expiration
- Logout endpoint for explicit termination
- Token validation on every protected endpoint

**Password Security:**
- Never transmit unencrypted
- Use HTTPS only (mandatory in production)
- Hash with bcrypt (minimum 10 rounds)
- No password hints or recovery in MVP (future feature)

---

### Feature 2: Digital Wallet

**Wallet Structure:**
```
user_id: UUID
user_name: String
email: String (unique)
password_hash: String
balance_paisa: BIGINT (represents ৳ as integer paisa)
  Example: ৳2,500.75 → 250075 paisa
account_status: ENUM (ACTIVE, SUSPENDED, CLOSED)
account_created_at: Timestamp
last_activity_at: Timestamp
```

**Key Properties:**
- Every new user receives exactly BDT 100,000 (10000000 paisa)
- Balance is ALWAYS an integer (no floating-point)
- Balance is NEVER negative (enforced at database level)
- Balance updates are atomic (all-or-nothing)
- Balance reflects all completed transactions

**Balance Display:**
- UI converts paisa to display: `balance_paisa / 100` shows ৳X.XX
- Display formatted as: `৳2,500.00` (currency symbol + two decimals)
- Display reflects only completed transactions

**Account Constraints:**
- Email must be unique
- Email must be valid format
- Account can have only one active wallet
- Balance cannot go below 0

---

### Feature 3: Money Transfer

**Transfer Flow:**

```
User A initiates transfer
    ↓
Input validation (amount, recipient)
    ↓
Authentication check
    ↓
Idempotency check (has this exact request been processed?)
    ↓
Balance availability check (pre-flight validation)
    ↓
Database transaction begins:
  - Acquire lock on sender's wallet
  - Verify balance sufficient
  - Deduct from sender
  - Create ledger entry (debit)
  - Acquire lock on receiver's wallet
  - Verify receiver exists
  - Credit to receiver
  - Create ledger entry (credit)
  - Create transfer record (status COMPLETED)
  - Update transfer record (mark COMPLETED)
    ↓
Database transaction commits
    ↓
Send notification to receiver (fire-and-forget)
    ↓
Return result to sender with transaction ID
```

**Transfer Record Schema:**
```
id: UUID (transaction ID, unique, immutable)
sender_id: UUID (foreign key)
receiver_id: UUID (foreign key)
amount_paisa: BIGINT
status: ENUM (PENDING, PROCESSING, COMPLETED, FAILED)
type: ENUM (TRANSFER, MONEY_REQUEST_APPROVAL)
note: String (optional, max 500 chars)
idempotency_key: String (unique, for deduplication)
created_at: Timestamp
updated_at: Timestamp
failure_reason: String (if FAILED)
```

**Transfer Constraints:**
- sender_id ≠ receiver_id (prevent self-transfer)
- amount_paisa > 0 (no zero/negative transfers)
- receiver must exist and be ACTIVE
- status transitions: PENDING → PROCESSING → COMPLETED or PENDING → FAILED
- Transfers cannot be modified after COMPLETED
- Each transfer has unique ID usable for lookup

**User Experience:**
1. User enters recipient name
2. System searches for exact match or similar names
3. User selects recipient
4. User enters amount
5. User optionally adds note
6. Confirmation screen shows:
   - Recipient name
   - Amount in clear format (৳X.XX)
   - Note (if any)
   - Fee (none in MVP)
   - "This transfer is final" warning
7. User clicks final "Confirm"
8. System processes atomically
9. Result screen shows:
   - Status: "Transfer Completed"
   - Transaction ID (unique, copyable)
   - Amount
   - Recipient
   - Timestamp
   - "Transaction ID required for support inquiries"
10. Receipt downloadable/shareable
11. Auto-redirect to dashboard after 3 seconds
12. Transaction appears in history immediately

---

### Feature 4: Money Request

**Request Flow:**

```
User A (requester) initiates request
    ↓
Search/select User B (requestee)
    ↓
Enter amount and reason
    ↓
Validate inputs
    ↓
Create request record (status PENDING)
    ↓
Send notification to User B
    ↓
Show confirmation to User A
    ↓
When User B views request:
    ↓
If User B clicks "Approve":
  - Execute transfer (same as manual transfer)
  - Mark request as APPROVED
  - Notify User A
Else if User B clicks "Reject":
  - Mark request as REJECTED
  - Notify User A
    ↓
User A can cancel pending request at any time
    ↓
Cancelled request marked as CANCELLED
```

**Money Request Record Schema:**
```
id: UUID (request ID, unique)
requester_id: UUID (who asked for money)
requestee_id: UUID (who was asked)
amount_paisa: BIGINT
reason: String (max 200 chars)
status: ENUM (PENDING, APPROVED, REJECTED, CANCELLED, EXPIRED)
created_at: Timestamp
expires_at: Timestamp (30 days default)
approved_at: Timestamp (if approved)
rejection_reason: String (optional)
related_transfer_id: UUID (if approved, links to the transfer)
```

**Constraints:**
- requester_id ≠ requestee_id
- amount_paisa > 0
- status transitions: PENDING → {APPROVED, REJECTED, CANCELLED, EXPIRED}
- Approval requires requestee to have sufficient balance at approval time
- Requests expire after 30 days (can be cancelled earlier)
- Each approval creates a linked transfer record

**User Experience:**
1. Requester clicks "Request Money"
2. Searches for and selects requestee
3. Enters amount and reason
4. Confirmation shows details
5. Request sent, requester sees confirmation
6. Requestee receives notification with quick action buttons
7. If approved: transfer executes, both parties see transaction
8. If rejected: requester notified, no transfer
9. Expired requests automatically marked EXPIRED after 30 days

---

### Feature 5: Transaction History

**Query Capabilities:**
- Retrieve all transactions for a user (pagination, 20 per page default)
- Filter by type: TRANSFER_SENT, TRANSFER_RECEIVED, REQUEST_SENT, REQUEST_RECEIVED
- Filter by status: COMPLETED, FAILED, PENDING, APPROVED, REJECTED
- Filter by date range
- Sort by date (newest first, default)

**History Display:**
- Transaction list shows:
  - Other party name (sender/receiver/requester)
  - Amount (with currency symbol)
  - Status badge (color-coded if possible)
  - Timestamp (relative: "2 minutes ago", "3 days ago")
  - Optional: note preview

- Clicking transaction shows full details:
  - Unique transaction ID (copyable, allows manual lookup)
  - Type (Transfer Sent / Transfer Received / Money Requested / Request From / Request Approved)
  - Counterparty full name
  - Amount (clear formatting)
  - Status (with explanation if not obvious)
  - Note / reason (full text)
  - Exact timestamp
  - Balance before
  - Balance after

**Data Retention:**
- All transaction records retained permanently (immutable)
- No record deletions (audit requirement)
- History accessible at any time

---

### Feature 6: Transaction Status & Clarity

**Transaction Status States:**

| Status | Meaning | User Sees | Backend Transitions To |
|--------|---------|-----------|----------------------|
| PENDING | Created, awaiting processing | "Transfer in progress..." | PROCESSING |
| PROCESSING | Actively processing | "Transfer in progress..." | COMPLETED or FAILED |
| COMPLETED | Successfully executed, money moved | "Transfer completed" + TXN-ID | (terminal) |
| FAILED | Execution failed, no money moved | "Transfer failed: [reason]" | (terminal) |
| REJECTED (Request only) | Request declined by recipient | "Request rejected" | (terminal) |
| APPROVED (Request only) | Request approved, transfer executed | See related transfer status | (terminal) |
| CANCELLED (Request only) | Requester cancelled the request | "Request cancelled" | (terminal) |
| EXPIRED (Request only) | Request expired after 30 days | "Request expired" | (terminal) |

**Status Determination:**
- After user initiates transfer, system shows PENDING immediately
- Backend atomically processes or fails
- If network timeout: user can check status later (fetch by transaction ID)
- Status never changes after becoming COMPLETED or FAILED

**User-Facing Status Messages:**

| Scenario | Message |
|----------|---------|
| Transfer completed | "✓ Your transfer of ৳2,500 to Fatima Khan was completed successfully at 2:30 PM. Transaction ID: TXN-XXXX" |
| Transfer failed - insufficient balance | "✗ Transfer failed: Your available balance (৳1,500) is less than the amount you tried to send (৳2,500)." |
| Transfer failed - recipient not found | "✗ Transfer failed: The recipient account no longer exists or is inactive." |
| Transfer failed - network error | "⏳ Transfer status uncertain. Check your transaction history or contact support with Transaction ID if needed." |
| Transfer in progress | "⏳ Processing your transfer... This usually takes less than 10 seconds." |

---

### Feature 7: Notifications

**Push Notification Triggers:**

| Event | Recipient | Message |
|-------|-----------|---------|
| Successful transfer | Receiver | "Received ৳2,500 from Rana Ahmed" |
| Money request received | Requestee | "Arjun Roy requested ৳1,200 - Lunch" |
| Request approved | Requester | "Rana Ahmed approved your ৳1,200 request" |
| Request rejected | Requester | "Rana Ahmed rejected your ৳1,200 request" |
| Request expires | Requester | "Your request to Rana Ahmed for ৳1,200 has expired" |
| Request cancelled | Requestee | "Rana Ahmed cancelled their ৳1,200 request" |

**Notification System:**
- **In-app notifications:** Delivered immediately, stored in database
- **Push notifications:** (Optional for MVP) Best-effort delivery
- **Email notifications:** (Optional for MVP) Transactional emails on critical events
- **In-app notification history:** Users can view past notifications
- **Notification dismissal:** Users can mark as read

**Notification Reliability:**
- Notifications are fire-and-forget (best effort)
- Lack of notification does NOT block transaction completion
- Users can always query transaction status via history/API
- System focuses on transaction correctness, not notification delivery

---

### Feature 8: Search & Discovery

**User Search:**
- Search by full name (partial match)
- Search by email (partial match)
- Results show: Name, email, option to select
- No user data leakage (cannot see balances of others)

**Transaction Lookup:**
- Search by transaction ID
- Shows transaction details if user is party to transaction
- Prevents unauthorized viewing of other users' transactions

---

## 7. MONEY MOVEMENT ENGINE (CRITICAL)

This is the core of the application. **Every design decision must prioritize correctness and concurrency safety.**

### 7.1 Transaction Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRANSFER LIFECYCLE                           │
└─────────────────────────────────────────────────────────────────┘

1. CLIENT SIDE: User initiates transfer
   ↓
2. API: POST /transfers
   ├─ Authentication check
   ├─ Input validation
   ├─ Generate idempotency_key
   └─ Return 202 ACCEPTED (async processing accepted)
   ↓
3. BACKEND: Process transaction
   │
   ├─ Idempotency check: Is this idempotency_key already processed?
   │  ├─ YES: Return existing result (no duplicate execution)
   │  └─ NO: Proceed
   │
   ├─ Create transfer record (status: PENDING)
   │
   ├─ Database Transaction Begins:
   │  ├─ Acquire row lock on sender wallet
   │  ├─ Verify balance ≥ amount
   │  │  ├─ If NO: Release lock, mark transfer FAILED
   │  │  └─ If YES: Proceed
   │  ├─ Deduct amount from sender balance
   │  ├─ Create ledger entry (sender: -amount)
   │  ├─ Acquire row lock on receiver wallet
   │  ├─ Verify receiver is ACTIVE
   │  │  ├─ If NO: ROLLBACK entire transaction, mark FAILED
   │  │  └─ If YES: Proceed
   │  ├─ Add amount to receiver balance
   │  ├─ Create ledger entry (receiver: +amount)
   │  ├─ Mark transfer COMPLETED
   │  └─ Commit (atomic: all or nothing)
   │
   ├─ Asynchronous: Send notification to receiver
   │  (Fire-and-forget, no retry, non-blocking)
   │
   └─ Return result to client
   ↓
4. CLIENT: Display result
   ├─ Show transaction ID
   ├─ Show status: COMPLETED or FAILED
   ├─ Show clear message
   └─ Link to transaction details

5. LATER: User can query status
   └─ GET /transfers/{transaction_id}
   └─ Returns definitive state (COMPLETED/FAILED)
```

### 7.2 Database-Level Atomicity

**SQL Pseudocode (Conceptual):**

```sql
BEGIN TRANSACTION;
  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  
  -- Lock sender wallet for update
  SELECT * FROM wallets 
  WHERE user_id = @sender_id 
  FOR UPDATE;
  
  -- Verify balance (now safely locked)
  IF wallet.balance_paisa < @amount THEN
    ROLLBACK;
    RETURN ERROR: INSUFFICIENT_BALANCE;
  END IF;
  
  -- Deduct from sender
  UPDATE wallets 
  SET balance_paisa = balance_paisa - @amount
  WHERE user_id = @sender_id;
  
  -- Log debit entry
  INSERT INTO ledger_entries 
  VALUES (@sender_id, -@amount, @transfer_id, @timestamp);
  
  -- Lock receiver wallet
  SELECT * FROM wallets 
  WHERE user_id = @receiver_id 
  FOR UPDATE;
  
  -- Verify receiver exists and is active
  IF wallet IS NULL OR wallet.status != 'ACTIVE' THEN
    ROLLBACK;
    RETURN ERROR: RECEIVER_NOT_FOUND;
  END IF;
  
  -- Credit to receiver
  UPDATE wallets 
  SET balance_paisa = balance_paisa + @amount
  WHERE user_id = @receiver_id;
  
  -- Log credit entry
  INSERT INTO ledger_entries 
  VALUES (@receiver_id, @amount, @transfer_id, @timestamp);
  
  -- Mark transfer completed
  UPDATE transfers 
  SET status = 'COMPLETED', updated_at = NOW()
  WHERE id = @transfer_id;
  
COMMIT TRANSACTION;
```

**Key Properties:**
- **SERIALIZABLE isolation:** Prevents any concurrent interference
- **Row-level locks:** Only locked users' wallets, minimal contention
- **Atomicity:** If ANY step fails, entire transaction rolls back
- **No dirty reads:** Cannot see uncommitted changes
- **No phantom reads:** Cannot see partially committed state

### 7.3 Double-Spending Prevention

**Problem:** Two concurrent requests from same user can overdraw.

```
Balance: ৳10,000
Request A: Send ৳8,000
Request B: Send ৳7,000
Arrives simultaneously

WRONG (naive): Both check balance (OK), both deduct → ৳-5,000 disaster
RIGHT: Database locks prevent this
```

**Solution: Database Constraints + Locking**

```sql
-- Database constraint: Balance can never go negative
ALTER TABLE wallets 
ADD CONSTRAINT balance_non_negative 
CHECK (balance_paisa >= 0);

-- Transactions use row-level locks (SELECT FOR UPDATE)
-- This forces serialization of balance updates

-- When Request A arrives:
SELECT * FROM wallets WHERE user_id = X FOR UPDATE;
  -- Acquires exclusive lock on wallet row
  -- Request B must WAIT (blocked)
  
  -- Request A verifies balance (safe, locked)
  -- Request A deducts ৳8,000
  -- Wallet now has ৳2,000
  
  -- Commit, lock released

-- Request B can now proceed:
SELECT * FROM wallets WHERE user_id = X FOR UPDATE;
  -- Now acquires lock on same row
  -- Sees balance ৳2,000
  -- Attempts to deduct ৳7,000
  -- FAILS: balance would go negative, violates constraint
  -- ROLLBACK, returns error
```

**Result:** First transaction succeeds, second fails with INSUFFICIENT_BALANCE (correct).

### 7.4 Concurrency Control Strategy

**Isolation Level:** SERIALIZABLE (strict)
- Most conservative but correct
- May have slight performance impact
- Unacceptable race conditions prevention worth the trade-off
- Hackathon scope: acceptable; production would optimize carefully

**Locking Strategy:** Pessimistic (row-level locks)
- Each transaction acquires locks on affected rows
- Blocked transactions wait for locks to release
- Prevents race conditions by design
- Deadlock possible (see handling below)

**Deadlock Handling:**
```
Scenario: Atomic swaps (future)
User A sends to User B while User B sends to User A
→ Risk: A locks, B locks, A waits for B, B waits for A (circular wait)

Prevention:
- Acquire locks in consistent order (lower user_id first)
- Implement deadlock detection timeout (retry after 100ms)
- Exponential backoff (100ms → 200ms → 400ms)
- Max retries: 3
```

**Concurrency Test Scenario:**
```
Time T0: Balance = ৳10,000
Time T0+0ms: User A sends ৳6,000 (Request 1)
Time T0+1ms: User B sends ৳7,000 (Request 2) [same user A!]

Expected outcome:
- One transaction: COMPLETED
- Other transaction: FAILED (INSUFFICIENT_BALANCE)
- Final balance: ৳4,000
- Both users see consistent history
```

### 7.5 Idempotency

**Problem:** Request arrives multiple times (network retry, double-click).
- Want: Execute once
- Prevent: Multiple debits for single transfer

**Solution: Idempotency Keys**

**Request Format:**
```json
{
  "receiver_id": "uuid-xyz",
  "amount_paisa": 250000,
  "note": "Lunch",
  "idempotency_key": "req-client-20260829-1234567890"
}
```

**Key Generation (Client-Side):**
```javascript
// Client generates stable key from request content
const idempotency_key = `req-${user_id}-${timestamp}-${crypto.random()}`;
// Store in browser sessionStorage
// Retry uses same key
```

**Server-Side Handling:**
```
1. Receive transfer request with idempotency_key
   ↓
2. Database lookup:
   SELECT * FROM idempotency_records 
   WHERE idempotency_key = @key AND user_id = @user_id
   
3a. If found (KEY EXISTS):
    → Return cached result immediately
    → No duplicate execution
    → Client receives same response as before
    
3b. If not found (FIRST TIME):
    → Create idempotency record (status: PROCESSING)
    → Execute transfer atomically
    → Update idempotency record (status: COMPLETED, result stored)
    → Return result
```

**Idempotency Record Schema:**
```
id: UUID
idempotency_key: String (unique per user)
user_id: UUID (sender)
status: ENUM (PROCESSING, COMPLETED, FAILED)
request_payload: JSON (original request)
response_payload: JSON (cached result)
created_at: Timestamp
expires_at: Timestamp (24 hours)
```

**Idempotency Key Uniqueness:**
- Unique constraint: `(user_id, idempotency_key)` cannot repeat
- Prevents same user sending two different requests with same key
- Key scoped to user: User A's key "key-123" is different from User B's "key-123"

**Cache Expiration:**
- Idempotency records kept for 24 hours
- After 24 hours, key can be reused (different transfer)
- Balances time-limited retry window with key reuse

**Idempotency Guarantees:**
- ✓ Double-click: Same key, returns cached result
- ✓ Browser retry: Same key, returns cached result
- ✓ Network timeout: Client can retry safely
- ✓ Duplicate API request: Handled by key deduplication

### 7.6 Failure Handling

**Scenario 1: Network Timeout (Client Perspective)**

```
Client → POST /transfers → Server
         (network drops)
         Client doesn't receive response
         Client doesn't know if transfer succeeded

Solution:
1. Client stores idempotency_key locally
2. User can manually retry with same idempotency_key
3. Server returns cached result if already processed
4. After 30 seconds, show: "Transfer status uncertain"
   - Provide transaction ID (if assigned)
   - Option to "Check Status" (calls GET /transfers/{id})
   - Clear message: "Don't retry yet, checking server..."
5. Polling: Client queries server every 5 seconds for 2 minutes
6. Result: Definitive COMPLETED or FAILED state

User sees:
  "Your transfer may have been sent. Checking status..."
  [Checking] ... [Checking] ...
  → "✓ Transfer completed successfully"
  (Money already arrived, notification sent)
```

**Scenario 2: Server Crash Mid-Transaction**

```
Server processing transfer:
  ✓ Locked wallets
  ✓ Deducted from sender
  ✓ Created ledger entry (debit)
  ✗ CRASH before crediting receiver

Recovery:
1. Transaction is rolled back (sender refunded)
2. Ledger entry still exists (mismatch detected on startup)
3. Health check identifies inconsistency
4. System alerts operators
5. Operators can manually investigate and reconcile
6. Transfer can be retried by user (idempotency key protects)

User sees:
  ✗ "Transfer failed: Server error. Retry your transfer"
  [Retry] button available
  Retry uses same idempotency_key, succeeds second time
```

**Scenario 3: Notification Failure**

```
Transfer executed successfully:
  ✓ Sender debited
  ✓ Receiver credited
  ✓ Balances updated
  ✗ Notification service down

Result:
  - Transfer is COMPLETED (data consistent)
  - Receiver doesn't get push notification
  - But transaction appears in receiver's history
  - Receiver still sees balance updated
  - Receiver can discover transaction by checking app

Recovery:
  - Notification retried asynchronously
  - Eventually delivered (or logged as failed)
  - Transaction is never dependent on notification success
  - Prioritizes correctness over notification delivery
```

**Scenario 4: Database Connection Lost**

```
Transfer processing:
  - Begin transaction
  - Acquired locks
  - ✗ Connection drops before COMMIT

Result:
  - Transaction AUTOMATICALLY rolled back
  - Locks released
  - No partial state
  - Sender balance unchanged
  - Receiver balance unchanged

User sees:
  ✗ "Transfer failed: Database error. Please try again"
  - Can safely retry (idempotency key protects)
```

**Scenario 5: Validation Failure During Transfer**

```
Recipient validation fails (account was deleted):
  ✓ Sender locked
  ✓ Sender balance verified
  ✗ Receiver account not found

Recovery:
  - ROLLBACK transaction
  - Sender balance restored
  - Transfer marked FAILED
  - Clear error: "Recipient account no longer exists"

User sees:
  ✗ "Transfer failed: Recipient account not found"
  - Clear reason
  - No money deducted
```

---

## 8. LEDGER / TRANSACTION MODEL

**Design Decision:** Use explicit ledger entries + wallet balance (not just balance).

### Why?

| Approach | Pros | Cons | Used? |
|----------|------|------|-------|
| **Balance only** | Simple | No auditability, cannot verify how balance changed, no history | ✗ No |
| **Ledger only** | Auditable, traceable | Slower queries, must sum entries | ✗ Limited |
| **Balance + Ledger** | Fast, auditable, traceable | More writes | ✓ **Yes** |

### Data Model

**Wallets Table (Fast Lookup):**
```sql
CREATE TABLE wallets (
  user_id UUID PRIMARY KEY,
  balance_paisa BIGINT NOT NULL CHECK (balance_paisa >= 0),
  account_status ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED'),
  updated_at TIMESTAMP DEFAULT NOW()
);
```
**Purpose:** Quick, consistent balance view. Single row update per transaction.

**Ledger Entries Table (Immutable History):**
```sql
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  amount_paisa BIGINT NOT NULL (can be negative for debits),
  transfer_id UUID FOREIGN KEY,
  entry_type ENUM ('TRANSFER_DEBIT', 'TRANSFER_CREDIT', 'INITIAL_FUNDING'),
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES wallets(user_id),
  FOREIGN KEY (transfer_id) REFERENCES transfers(id)
);
CREATE INDEX idx_ledger_user_date ON ledger_entries(user_id, created_at DESC);
```
**Purpose:** Immutable audit trail. Verify balance calculations, trace transactions.

**Transfers Table (Transaction Record):**
```sql
CREATE TABLE transfers (
  id UUID PRIMARY KEY,
  sender_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa > 0),
  status ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') DEFAULT 'PENDING',
  type ENUM ('TRANSFER', 'REQUEST_APPROVAL') DEFAULT 'TRANSFER',
  note VARCHAR(500),
  idempotency_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  failure_reason VARCHAR(255),
  FOREIGN KEY (sender_id) REFERENCES wallets(user_id),
  FOREIGN KEY (receiver_id) REFERENCES wallets(user_id),
  UNIQUE (sender_id, idempotency_key),
  CHECK (sender_id != receiver_id)
);
CREATE UNIQUE INDEX idx_transfer_id ON transfers(id);
CREATE INDEX idx_transfer_sender_date ON transfers(sender_id, created_at DESC);
CREATE INDEX idx_transfer_receiver_date ON transfers(receiver_id, created_at DESC);
CREATE INDEX idx_transfer_idempotency ON transfers(sender_id, idempotency_key);
```
**Purpose:** Track transfers, idempotency, status.

### System Invariant

**INVARIANT:** Total money in system = sum of all wallet balances

**Verification Logic:**
```sql
SELECT 
  COUNT(*) as total_wallets,
  SUM(balance_paisa) as total_balance_paisa,
  ROUND(SUM(balance_paisa) / 100.0, 2) as total_balance_bdt
FROM wallets
WHERE account_status = 'ACTIVE';

-- Should equal:
-- total_wallets * 100,000,000 (paisa)
-- minus any closed accounts
-- plus any special additions
```

**Verification on Startup:**
```
System starts:
  1. Compute sum(wallet.balance_paisa)
  2. Count ledger entries and verify sum(ledger_entry.amount)
  3. If mismatch detected:
     → Log CRITICAL error
     → Alert operator
     → Do NOT process transactions until verified
     → Investigate via transaction history
```

**Transaction Balance Check:**
```
Every transfer:
  Before commit, verify:
  - Sender balance ≥ transfer amount (or abort)
  - Receiver balance + transfer amount won't overflow (BigInt protected)
  - Ledger entry created for debit
  - Ledger entry created for credit
  After commit:
  - Ledger debit + ledger credit = 0 (net effect on system)
```

---

## 9. DATA MODEL

### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  account_status ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED') DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP
);
CREATE INDEX idx_users_email ON users(email);
```

### Wallets Table
```sql
CREATE TABLE wallets (
  user_id UUID PRIMARY KEY,
  balance_paisa BIGINT NOT NULL CHECK (balance_paisa >= 0),
  currency ENUM ('BDT') DEFAULT 'BDT',
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (user_id)
);
CREATE INDEX idx_wallet_updated ON wallets(updated_at DESC);
```

### Transfers Table
```sql
CREATE TABLE transfers (
  id UUID PRIMARY KEY,
  sender_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa > 0),
  status ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') DEFAULT 'PENDING',
  type ENUM ('TRANSFER', 'REQUEST_APPROVAL') DEFAULT 'TRANSFER',
  note VARCHAR(500),
  idempotency_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  failure_reason VARCHAR(255),
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (receiver_id) REFERENCES users(id),
  CHECK (sender_id != receiver_id),
  UNIQUE (sender_id, receiver_id, idempotency_key, created_at)
);
CREATE UNIQUE INDEX idx_transfer_id ON transfers(id);
CREATE INDEX idx_transfer_sender ON transfers(sender_id, created_at DESC);
CREATE INDEX idx_transfer_receiver ON transfers(receiver_id, created_at DESC);
CREATE INDEX idx_transfer_status ON transfers(status, created_at DESC);
CREATE INDEX idx_transfer_idempotency ON transfers(sender_id, idempotency_key);
```

### Ledger Entries Table
```sql
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  amount_paisa BIGINT NOT NULL,  -- Signed integer (negative = debit)
  transfer_id UUID NOT NULL,
  entry_type ENUM ('TRANSFER_DEBIT', 'TRANSFER_CREDIT', 'INITIAL_FUNDING', 'CORRECTION'),
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (transfer_id) REFERENCES transfers(id)
);
CREATE INDEX idx_ledger_user ON ledger_entries(user_id, created_at DESC);
CREATE INDEX idx_ledger_transfer ON ledger_entries(transfer_id);
```

### Money Requests Table
```sql
CREATE TABLE money_requests (
  id UUID PRIMARY KEY,
  requester_id UUID NOT NULL,
  requestee_id UUID NOT NULL,
  amount_paisa BIGINT NOT NULL CHECK (amount_paisa > 0),
  reason VARCHAR(200),
  status ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED') DEFAULT 'PENDING',
  related_transfer_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (requestee_id) REFERENCES users(id),
  FOREIGN KEY (related_transfer_id) REFERENCES transfers(id),
  CHECK (requester_id != requestee_id)
);
CREATE INDEX idx_request_requester ON money_requests(requester_id, created_at DESC);
CREATE INDEX idx_request_requestee ON money_requests(requestee_id, status, created_at DESC);
CREATE INDEX idx_request_expires ON money_requests(expires_at) WHERE status = 'PENDING';
```

### Idempotency Records Table
```sql
CREATE TABLE idempotency_records (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  request_payload JSONB NOT NULL,
  response_payload JSONB NOT NULL,
  status ENUM ('PROCESSING', 'COMPLETED', 'FAILED') DEFAULT 'PROCESSING',
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (user_id, idempotency_key),
  INDEX idx_idempotency_user_key ON (user_id, idempotency_key)
);
CREATE INDEX idx_idempotency_expires ON idempotency_records(expires_at) WHERE status != 'COMPLETED';
```

### Notifications Table (Optional for MVP)
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  type ENUM ('TRANSFER_RECEIVED', 'REQUEST_RECEIVED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_CANCELLED', 'REQUEST_EXPIRED') NOT NULL,
  related_transfer_id UUID,
  related_request_id UUID,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (related_transfer_id) REFERENCES transfers(id),
  FOREIGN KEY (related_request_id) REFERENCES money_requests(id)
);
CREATE INDEX idx_notification_user_read ON notifications(user_id, is_read, created_at DESC);
```

### Key Indexes Summary
| Table | Index | Purpose |
|-------|-------|---------|
| wallets | PRIMARY (user_id) | Fast balance lookup |
| transfers | PRIMARY (id) | Fast transfer lookup |
| transfers | (sender_id, created_at DESC) | User's outgoing transfers |
| transfers | (receiver_id, created_at DESC) | User's incoming transfers |
| transfers | (status, created_at DESC) | Query pending transfers |
| transfers | (sender_id, idempotency_key) | Idempotency check |
| ledger_entries | (user_id, created_at DESC) | User's full history |
| money_requests | (requestee_id, status, created_at DESC) | Pending requests for user |
| money_requests | (expires_at) | Find expired requests (cleanup) |

---

## 10. MONEY / CURRENCY REPRESENTATION

**Decision:** Store all amounts as **BIGINT paisa** (not floating-point BDT).

### Rationale

**Why NOT floating-point?**
```javascript
// IEEE 754 floating-point
0.1 + 0.2 === 0.3  // FALSE in JavaScript!
// Result: 0.30000000000000004

// In banking, this is unacceptable
// ৳2,500.10 + ৳3,400.20 must = ৳5,900.30 EXACTLY
```

**Why paisa (1/100 of BDT)?**
```
৳2,500.75 = 250075 paisa
- Integer arithmetic: no precision loss
- Natural unit (Bangladeshi currency already uses 2 decimals)
- Prevents accidental fractional amounts
- Paisa is smallest unit (can enforce integer constraint)

Database:
  amount_paisa BIGINT  -- Stores 250075 (represents ৳2,500.75)
  
Display:
  display_amount = amount_paisa / 100  -- ৳2,500.75
  display_string = `৳${(amount_paisa / 100).toFixed(2)}`
```

**Conversion Rules:**

| Input | Storage | Display |
|-------|---------|---------|
| User enters: ৳2,500 | 250000 paisa | ৳2,500.00 |
| User enters: ৳2,500.50 | 250050 paisa | ৳2,500.50 |
| User enters: ৳2,500.75 | 250075 paisa | ৳2,500.75 |
| Invalid: ৳2,500.5555 | REJECTED | N/A |

**Validation:**
```javascript
// User input validation
function validateAmount(input) {
  // Accept: "2500" or "2500.50" or "2500.75"
  // Reject: "2500.5555" (more than 2 decimals)
  
  const parts = input.split('.');
  if (parts.length > 2) return false;  // Invalid format
  if (parts[1] && parts[1].length > 2) return false;  // Too many decimals
  
  const bdt = parseFloat(input);
  if (isNaN(bdt) || bdt <= 0) return false;  // Non-positive
  
  const paisa = Math.round(bdt * 100);  // Round to nearest paisa
  return paisa;  // Return paisa
}

// Database storage
INSERT INTO transfers (amount_paisa) VALUES (250075);

// Display on frontend
const paisa = 250075;
const bdt_display = (paisa / 100).toFixed(2);  // "2500.75"
console.log(`৳${bdt_display}`);
```

**Constraints:**
- Minimum amount: 1 paisa (৳0.01)
- Maximum amount per transaction: 9,223,372,036,854,775,807 paisa (BIGINT max, covers ৳92 trillion)
- Fractional paisa: NOT supported (rejected at input validation)

**System-Wide Property:**
All monetary amounts are BIGINT paisa. No exceptions.

---

## 11. DATABASE TRANSACTION & CONCURRENCY STRATEGY

### Isolation Level

**Choice: SERIALIZABLE**

```sql
SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

**Why SERIALIZABLE?**
- Prevents ALL isolation anomalies (dirty read, non-repeatable read, phantom read)
- Correct by design (no race condition bugs)
- Slightly higher latency (acceptable for hackathon)
- Production systems often use REPEATABLE READ + application logic, but SERIALIZABLE is safer for correctness

**Alternative: REPEATABLE READ**
- Good enough if you implement application-level validation
- Requires careful lock ordering and validation steps
- Higher risk of race conditions if implemented incorrectly
- For MVP: SERIALIZABLE is safer

### Locking Strategy

**Row-Level Pessimistic Locking**

```sql
BEGIN TRANSACTION;
  -- Lock sender's wallet for modification
  SELECT * FROM wallets 
  WHERE user_id = $1 
  FOR UPDATE 
  NOWAIT;  -- Fail fast if locked, don't wait
  
  -- Now we have exclusive lock on sender's row
  -- No other transaction can modify sender's balance
  
  IF wallet.balance_paisa < amount THEN
    ROLLBACK;
    THROW INSUFFICIENT_BALANCE;
  END IF;
  
  -- Update sender safely (no one else can modify)
  UPDATE wallets 
  SET balance_paisa = balance_paisa - amount 
  WHERE user_id = $1;
  
  -- Lock receiver's wallet
  SELECT * FROM wallets 
  WHERE user_id = $2 
  FOR UPDATE 
  NOWAIT;
  
  IF wallet.status != 'ACTIVE' THEN
    ROLLBACK;
    THROW RECEIVER_NOT_FOUND;
  END IF;
  
  -- Update receiver
  UPDATE wallets 
  SET balance_paisa = balance_paisa + amount 
  WHERE user_id = $2;
  
  -- Record transfer
  INSERT INTO transfers (id, sender_id, receiver_id, amount_paisa, status) 
  VALUES ($3, $1, $2, amount, 'COMPLETED');
  
  INSERT INTO ledger_entries 
  VALUES 
    ($uid(), $1, -amount, $3, 'TRANSFER_DEBIT', NOW()),
    ($uid(), $2, +amount, $3, 'TRANSFER_CREDIT', NOW());
  
COMMIT;
```

**Lock Ordering**

To prevent deadlocks in complex scenarios (future):
```
Always acquire locks in a consistent order:
- Sender ID < Receiver ID: Lock sender first, then receiver
- Sender ID > Receiver ID: Still lock sender first, then receiver

Example:
  User A (id: ...A111) sends to User B (id: ...B222)
  → Lock A111 first, B222 second

  User B (id: ...B222) sends to User A (id: ...A111) simultaneously
  → Also lock A111 first, B222 second
  → No deadlock! Same order.
```

### Deadlock Handling

**Deadlock Prevention (Preferred):**
```
- Lock in consistent order (as above)
- Keep transactions short
- Avoid nested transactions
```

**Deadlock Recovery (If Occurs):**
```
IF database returns "Deadlock detected" error:
  → Retry transaction after exponential backoff
  → Max retries: 3
  → Backoff: 100ms → 200ms → 400ms
  
After max retries:
  → Return error to client
  → Client can retry (via idempotency key)
```

### Race Condition Prevention

**Scenario: Concurrent withdrawals from same account**

```
Balance: ৳10,000
Request A: Send ৳8,000
Request B: Send ৳7,000
Simultaneous arrival

Timeline:
T0: Request A acquires lock on wallet
T1: Request B waits for lock (blocked)
T2: Request A verifies balance (৳10,000 ≥ ৳8,000) ✓
T3: Request A deducts ৳8,000 (balance now ৳2,000)
T4: Request A commits, releases lock
T5: Request B acquires lock
T6: Request B verifies balance (৳2,000 ≥ ৳7,000) ✗
T7: Request B fails with INSUFFICIENT_BALANCE
T8: Request B rollbacks

Result: 
  - Balance: ৳2,000 (correct!)
  - History: A succeeds, B fails (correct!)
  - No race condition ✓
```

**Database Constraint (Defense in Depth):**
```sql
ALTER TABLE wallets
ADD CONSTRAINT balance_non_negative 
CHECK (balance_paisa >= 0);
```
Even if transaction logic has bug, database constraint prevents negative balance.

### Concurrency Test Protocol

**Test: Load spike (50+ simultaneous transfers)**

```
Setup:
  - User A with ৳100,000
  - 50 concurrent requests: each sends ৳2,000
  - Total requested: ৳100,000

Expected outcome:
  - ~50 succeeds, exactly fills balance
  - All subsequent fail with INSUFFICIENT_BALANCE
  - Final balance: ৳0
  - Zero duplicates
  - All 50 successful ledger entries present
  - Sum of ledger entries = 0 (system invariant)

Implementation:
  - Create 50 identical transfer requests
  - Fire all simultaneously (via thread pool or async)
  - Collect results
  - Assert: exactly 50 with INSUFFICIENT_BALANCE, exactly 50 with COMPLETED
```

---

## 12. API DESIGN

### API Overview

**Base URL:** `https://api.moneyflow.local` (hackathon), `https://api.moneyflow.app` (production)

**Authentication:** JWT Bearer Token
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Error Response Format (Standard):**
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Your available balance is insufficient for this transfer.",
    "details": {
      "required": 250000,
      "available": 150000
    }
  },
  "request_id": "req-20260829-1234567890"
}
```

**Success Response Format (Standard):**
```json
{
  "success": true,
  "data": { /* ... */ },
  "request_id": "req-20260829-1234567890"
}
```

---

### AUTH ENDPOINTS

#### POST /auth/register
**Register a new user**

**Request:**
```json
{
  "email": "rana@example.com",
  "password": "SecurePass123!",
  "full_name": "Rana Ahmed"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "user_id": "uuid-xyz",
    "email": "rana@example.com",
    "full_name": "Rana Ahmed",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_expires_in": 86400,
    "wallet": {
      "balance_bdt": 100000.00,
      "balance_paisa": 10000000,
      "currency": "BDT"
    }
  }
}
```

**Errors:**
- 400 Bad Request: Invalid email format
- 409 Conflict: Email already registered
- 422 Unprocessable Entity: Weak password

---

#### POST /auth/login
**Authenticate user and receive token**

**Request:**
```json
{
  "email": "rana@example.com",
  "password": "SecurePass123!"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user_id": "uuid-xyz",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_expires_in": 86400
  }
}
```

**Errors:**
- 400 Bad Request: Missing fields
- 401 Unauthorized: Invalid credentials
- 429 Too Many Requests: Too many login attempts (rate limit: 5 per minute)

---

#### POST /auth/logout
**Invalidate current session**

**Request:**
```
Authorization: Bearer [token]
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### WALLET ENDPOINTS

#### GET /wallet
**Get current wallet balance and account info**

**Request:**
```
Authorization: Bearer [token]
GET /wallet
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user_id": "uuid-xyz",
    "email": "rana@example.com",
    "full_name": "Rana Ahmed",
    "account_status": "ACTIVE",
    "wallet": {
      "balance_bdt": 47500.00,
      "balance_paisa": 4750000,
      "currency": "BDT",
      "updated_at": "2026-08-29T14:32:15Z"
    },
    "created_at": "2026-08-29T09:00:00Z",
    "last_activity_at": "2026-08-29T14:32:00Z"
  }
}
```

**Errors:**
- 401 Unauthorized: Invalid/expired token
- 404 Not Found: User not found

---

### TRANSFER ENDPOINTS

#### POST /transfers
**Initiate a money transfer**

**Request:**
```
Authorization: Bearer [token]
Content-Type: application/json
Idempotency-Key: req-user-20260829-1234567890
```

```json
{
  "receiver_id": "uuid-receiver",
  "amount_bdt": 2500.00,
  "note": "Lunch money"
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "data": {
    "transfer_id": "TXN-20260829-XXXXXXXXXXXX",
    "status": "PROCESSING",
    "sender_id": "uuid-sender",
    "receiver_id": "uuid-receiver",
    "amount_bdt": 2500.00,
    "created_at": "2026-08-29T14:32:15Z",
    "note": "Lunch money",
    "message": "Transfer is being processed. Check status below."
  }
}
```

**Idempotency:**
- Header: `Idempotency-Key` (required)
- Same key + same user = cached result if already processed
- Key format: `req-[user_id]-[timestamp]-[random]`

**Errors:**
- 400 Bad Request: Invalid amount/receiver
- 401 Unauthorized: Invalid token
- 404 Not Found: Receiver not found
- 422 Unprocessable Entity: Invalid amount (≤ 0)
- 409 Conflict: Self-transfer not allowed
- 402 Payment Required: Insufficient balance
- 429 Too Many Requests: Rate limited (max 10 transfers/minute)

---

#### GET /transfers/{transfer_id}
**Get transfer status and details**

**Request:**
```
Authorization: Bearer [token]
GET /transfers/TXN-20260829-XXXXXXXXXXXX
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "transfer_id": "TXN-20260829-XXXXXXXXXXXX",
    "status": "COMPLETED",
    "type": "TRANSFER",
    "sender": {
      "user_id": "uuid-sender",
      "full_name": "Rana Ahmed"
    },
    "receiver": {
      "user_id": "uuid-receiver",
      "full_name": "Fatima Khan"
    },
    "amount_bdt": 2500.00,
    "note": "Lunch money",
    "created_at": "2026-08-29T14:32:15Z",
    "completed_at": "2026-08-29T14:32:18Z",
    "your_balance_before": 50000.00,
    "your_balance_after": 47500.00
  }
}
```

**Errors:**
- 401 Unauthorized: Invalid token
- 404 Not Found: Transfer not found or no access
- 403 Forbidden: Not sender or receiver of this transfer

---

#### GET /transfers
**List user's transfers (paginated)**

**Request:**
```
Authorization: Bearer [token]
GET /transfers?page=1&limit=20&type=TRANSFER&status=COMPLETED&from_date=2026-08-28&to_date=2026-08-29
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 20, max: 100)
- `type`: Filter by type (TRANSFER_SENT, TRANSFER_RECEIVED, REQUEST_SENT, REQUEST_RECEIVED, all)
- `status`: Filter by status (COMPLETED, FAILED, PENDING, APPROVED, REJECTED, all)
- `from_date`: ISO date (inclusive)
- `to_date`: ISO date (inclusive)

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "transfers": [
      {
        "transfer_id": "TXN-20260829-XXXXXXXXXXXX",
        "type": "TRANSFER_RECEIVED",
        "other_party": "Rana Ahmed",
        "amount_bdt": 2500.00,
        "status": "COMPLETED",
        "created_at": "2026-08-29T14:32:15Z",
        "note": "Lunch money"
      },
      // ... more transfers
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "pages": 3
    }
  }
}
```

**Errors:**
- 401 Unauthorized: Invalid token
- 400 Bad Request: Invalid query parameters

---

### MONEY REQUEST ENDPOINTS

#### POST /money-requests
**Create a money request**

**Request:**
```
Authorization: Bearer [token]
POST /money-requests
```

```json
{
  "requestee_id": "uuid-requestee",
  "amount_bdt": 1200.00,
  "reason": "Lunch you bought for me"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "request_id": "REQ-20260829-XXXXXXXXXXXX",
    "status": "PENDING",
    "requester_id": "uuid-requester",
    "requestee_id": "uuid-requestee",
    "amount_bdt": 1200.00,
    "reason": "Lunch you bought for me",
    "created_at": "2026-08-29T14:32:15Z",
    "expires_at": "2026-09-28T14:32:15Z"
  }
}
```

**Errors:**
- 400 Bad Request: Invalid requestee/amount
- 401 Unauthorized: Invalid token
- 404 Not Found: Requestee not found
- 409 Conflict: Self-request not allowed

---

#### GET /money-requests
**Get user's money requests (received and sent)**

**Request:**
```
Authorization: Bearer [token]
GET /money-requests?direction=received&status=PENDING
```

**Query Parameters:**
- `direction`: received, sent, or all (default: all)
- `status`: PENDING, APPROVED, REJECTED, CANCELLED, EXPIRED, or all (default: all)

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "received": [
      {
        "request_id": "REQ-20260829-XXXXXXXXXXXX",
        "status": "PENDING",
        "requester": "Arjun Roy",
        "amount_bdt": 1200.00,
        "reason": "Lunch",
        "created_at": "2026-08-29T14:32:15Z",
        "expires_at": "2026-09-28T14:32:15Z"
      }
    ],
    "sent": []
  }
}
```

---

#### POST /money-requests/{request_id}/approve
**Approve a money request (execute transfer)**

**Request:**
```
Authorization: Bearer [token]
POST /money-requests/REQ-20260829-XXXXXXXXXXXX/approve
Idempotency-Key: [unique key]
```

**Response (200 OK / 202 Accepted):**
```json
{
  "success": true,
  "data": {
    "request_id": "REQ-20260829-XXXXXXXXXXXX",
    "status": "APPROVED",
    "related_transfer_id": "TXN-20260829-YYYYYYYYYYYY",
    "transfer_status": "COMPLETED",
    "amount_bdt": 1200.00,
    "approved_at": "2026-08-29T14:35:22Z"
  }
}
```

**Errors:**
- 402 Payment Required: Insufficient balance
- 404 Not Found: Request not found
- 409 Conflict: Request already approved/rejected/expired
- 403 Forbidden: User is not requestee

---

#### POST /money-requests/{request_id}/reject
**Reject a money request**

**Request:**
```
Authorization: Bearer [token]
POST /money-requests/REQ-20260829-XXXXXXXXXXXX/reject
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "request_id": "REQ-20260829-XXXXXXXXXXXX",
    "status": "REJECTED",
    "rejected_at": "2026-08-29T14:35:22Z"
  }
}
```

---

#### DELETE /money-requests/{request_id}
**Cancel a sent money request**

**Request:**
```
Authorization: Bearer [token]
DELETE /money-requests/REQ-20260829-XXXXXXXXXXXX
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "request_id": "REQ-20260829-XXXXXXXXXXXX",
    "status": "CANCELLED",
    "cancelled_at": "2026-08-29T14:35:22Z"
  }
}
```

---

### SEARCH ENDPOINTS

#### GET /users/search
**Search for users**

**Request:**
```
Authorization: Bearer [token]
GET /users/search?q=rana&limit=10
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "user_id": "uuid-123",
        "full_name": "Rana Ahmed",
        "email": "rana@example.com"
      }
    ]
  }
}
```

**Notes:**
- Returns only name and email (no balance)
- Limits results to 10 by default (max 50)

---

### TRANSACTION DETAILS

#### GET /transactions/{transaction_id}
**Get full transaction details (alternative to transfers endpoint)**

**Request:**
```
Authorization: Bearer [token]
GET /transactions/TXN-20260829-XXXXXXXXXXXX
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "transaction_id": "TXN-20260829-XXXXXXXXXXXX",
    "type": "TRANSFER",
    "subtype": "SENT",
    "status": "COMPLETED",
    "direction": "SENT",
    "counterparty": {
      "user_id": "uuid-receiver",
      "full_name": "Fatima Khan"
    },
    "amount_bdt": 2500.00,
    "currency": "BDT",
    "note": "Lunch money",
    "created_at": "2026-08-29T14:32:15Z",
    "completed_at": "2026-08-29T14:32:18Z",
    "your_balance_before_bdt": 50000.00,
    "your_balance_after_bdt": 47500.00,
    "fee_bdt": 0.00
  }
}
```

---

## 13. API ERROR MODEL

**Standard Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {
      "field": "value"
    }
  },
  "request_id": "req-20260829-1234567890"
}
```

### Error Codes & HTTP Status

| Code | HTTP | Meaning | Recovery |
|------|------|---------|----------|
| INVALID_AMOUNT | 422 | Amount ≤ 0, too large, or invalid format | Validate input, re-enter amount |
| INSUFFICIENT_BALANCE | 402 | Sender doesn't have enough money | Check balance, reduce amount |
| USER_NOT_FOUND | 404 | Recipient/requestee doesn't exist | Search and select valid user |
| SELF_TRANSFER_NOT_ALLOWED | 409 | Sender = Receiver | Select different recipient |
| RECEIVER_INACTIVE | 409 | Receiver account suspended/closed | Contact support |
| DUPLICATE_REQUEST | 409 | Idempotency key already processed | Don't retry, check status |
| TRANSFER_NOT_FOUND | 404 | Transfer ID doesn't exist | Verify ID, check history |
| TRANSFER_ALREADY_COMPLETED | 409 | Cannot modify completed transfer | N/A (transfer immutable) |
| TRANSFER_ALREADY_REJECTED | 409 | Cannot modify rejected transfer | N/A |
| UNAUTHORIZED | 401 | Invalid/expired token | Log in again |
| FORBIDDEN | 403 | User not party to transaction | Verify access rights |
| RATE_LIMITED | 429 | Too many requests | Wait and retry |
| INTERNAL_ERROR | 500 | Server error | Retry, contact support if persistent |
| DATABASE_ERROR | 500 | Database unavailable | Retry after 30 seconds |
| NETWORK_TIMEOUT | 504 | Request processing uncertain | Check status by ID |
| INVALID_REQUEST | 400 | Malformed request | Fix JSON format |
| WEAK_PASSWORD | 422 | Password doesn't meet criteria | Use stronger password |
| EMAIL_ALREADY_REGISTERED | 409 | Email in use | Use different email or log in |

---

## 14. SECURITY

### Authentication

**Registration:**
- Email format validation (RFC 5322 basic)
- Password strength enforcement:
  - Minimum 8 characters
  - Optional: Mix of uppercase, lowercase, numbers, symbols
- Password hashing: bcrypt with min 10 rounds
- Unique email constraint (database level)

**Login:**
- Email + password validation
- Brute-force protection:
  - Lock after 5 failed attempts
  - Lockout duration: 15 minutes
  - Alert user if suspicious activity detected (future: email notification)
- JWT token generation:
  - Payload includes: user_id, email, issued_at, expires_at
  - Secret: Strong random 32+ byte key (environment variable)
  - Algorithm: HS256 or RS256
  - Expiration: 24 hours (token refresh not in MVP)

**Session Management:**
- Stateless JWT (no server-side session store)
- Token validation on every protected endpoint
- Logout: Client-side token deletion (revocation list optional for MVP)

### Authorization

**Principle: Resource Ownership**

```
- User can only access own wallet
- User can only see own transactions
- User can only approve/reject requests sent to them
- User cannot modify other users' accounts
- No user can override transaction immutability
```

### Input Validation

**Amount Validation:**
- Positive integer (> 0)
- ≤ 900,000,000,000 (9 billion BDT, practical upper bound)
- Exact two decimals (no more, no less)
- Paisa representation: multiply by 100, reject if non-integer

**Email Validation:**
- Format check (basic regex or email library)
- Uniqueness check (database)
- No special validation (hackathon scope; production: email confirmation)

**Name Validation:**
- Non-empty (1–255 characters)
- No code injection attempts (sanitize if database allows)

**Note/Reason Validation:**
- Maximum length: 500 characters (transfer note), 200 characters (request reason)
- No validation needed (user-generated text)

**User ID Validation:**
- Must be UUID format
- Must correspond to existing user
- Must be different from sender (self-transfer check)

### Rate Limiting

**Endpoints:**
- POST /auth/login: 5 per minute per IP
- POST /auth/register: 3 per minute per IP
- POST /transfers: 10 per minute per user
- POST /money-requests: 20 per minute per user
- GET endpoints: 100 per minute per user

**Implementation:**
- Token bucket algorithm (or sliding window)
- Header: `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Response: 429 Too Many Requests when exceeded

### Sensitive Data Handling

**In Transit:**
- HTTPS only (TLS 1.2+, mandatory in production)
- No sensitive data in URLs (use POST body)
- Bearer token in Authorization header (not URL)

**At Rest:**
- Password hashes only (never plaintext)
- Tokens not persisted (stateless)
- Database encryption (production; hackathon: acceptable without)

**Logging:**
- Never log passwords
- Never log full tokens
- Log transaction IDs and user IDs (for debugging)
- Log error details (but not sensitive data)
- Mask email in logs (e.g., "ra...@example.com")

### Audit Logging

**Audit Trail:**
- Every transfer creation (user ID, transfer ID, amount, timestamp)
- Every transfer completion (user ID, transfer ID, final status)
- Every login attempt (user ID, timestamp, success/failure)
- Every failed authentication (email, timestamp, attempt count)
- Admin actions (if applicable): who viewed what, when

**Storage:**
- Immutable log entries (append-only, no deletion)
- Retention: 90 days minimum (hackathon); 7 years recommended (production)

### CSRF Protection (if web-based)

If frontend is web-based:
- CSRF tokens for state-changing operations (POST/PUT/DELETE)
- SameSite cookie attribute: Strict
- Custom header validation (X-CSRF-Token)

---

## 15. TRUST & TRANSPARENCY

### Transaction Traceability

**Every completed transfer shows:**
1. **Unique Transaction ID:** `TXN-20260829-XXXXXXXXXXXX`
   - Format: `TXN-[YYYYMMDD]-[random 12-char alphanumeric]`
   - Guaranteed unique
   - Can be used to query transaction status anytime

2. **Clear Status:**
   - NOT: "Processing"
   - Instead: "Transfer completed successfully at 2:30 PM"
   - Link to full transaction details

3. **Exact Amount:**
   - Display with currency symbol: `৳2,500.00`
   - No abbreviations or ambiguity
   - Show in both sender and receiver views

4. **Counterparty:**
   - Full name of other person
   - Not just user ID or email
   - Verified owner of account

5. **Timestamp:**
   - Exact time transaction completed
   - In user's local timezone (frontend-side conversion)
   - Also show server timestamp (UTC) if detailed view

6. **Balance Impact:**
   - Balance before transfer
   - Balance after transfer
   - Allows user to verify math

### Message Clarity

| Situation | Wrong Message | Correct Message |
|-----------|---------------|-----------------|
| Success | "OK" | "✓ Your transfer of ৳2,500 to Fatima Khan was completed successfully" |
| Insufficient balance | "Cannot process" | "✗ Your available balance (৳1,500) is less than the amount (৳2,500). Please reduce the amount or check your balance." |
| User not found | "Error" | "✗ We couldn't find a user named 'XYZ'. Please verify the name or search again." |
| Network timeout | "Try again" | "⏳ We're having trouble connecting to our server. Your transfer status is uncertain. Transaction ID: TXN-XXXX. [Check Status]" |
| Account suspended | "Access denied" | "Your account has been temporarily suspended. Please contact support: support@moneyflow.app" |

### Transaction Receipt

**After successful transfer, users see:**
```
═══════════════════════════════════════
              TRANSFER RECEIPT
═══════════════════════════════════════

✓ Transfer Completed

Transaction ID: TXN-20260829-ABC123XYZ789
Date & Time: 29 Aug 2026, 2:32 PM

FROM:
Rana Ahmed (You)

TO:
Fatima Khan

AMOUNT: ৳2,500.00

NOTE: Lunch money

YOUR BALANCE:
Before: ৳50,000.00
After:  ৳47,500.00

═══════════════════════════════════════
```

**Available actions:**
- [View Transaction Details]
- [Download Receipt as PDF]
- [Share Transaction ID with Support]
- [Back to Transfers]

### Transaction History Trust

**Requirements:**
- All transactions immutable (cannot be deleted or modified)
- All transactions logged in order (chronological)
- All transfers show both sender and receiver perspectives
- Money requests show request lifecycle
- Users can export transaction history (CSV, optional for MVP)

### Balance Verification

**Users can verify balance by:**
1. Checking dashboard: See current balance
2. Summing transactions: "Manual verification"
   - Add all received amounts
   - Subtract all sent amounts
   - Compare to displayed balance
   - Should match exactly

**If mismatch occurs:**
- Contact support with transaction IDs
- System maintains ledger entries for investigation
- Engineers can trace using transaction IDs and ledger

---

## 16. UI/UX DESIGN

### Design Philosophy

- **Clarity over cleverness:** Every action's result must be obvious
- **Trust through transparency:** Users always know transaction status
- **Accessibility:** Should work on slow networks, old devices
- **Progressive disclosure:** Show only relevant information, hide complexity

### Dashboard (Landing)

**Elements:**

```
┌────────────────────────────────────────────────┐
│ MoneyFlow                         [Profile] [⋯] │
├────────────────────────────────────────────────┤
│                                                 │
│  Welcome, Rana Ahmed                           │
│                                                 │
│  Your Balance:                                  │
│  ৳47,500.00                                    │
│  (Last updated 2 minutes ago)                  │
│                                                 │
│ ┌──────────────────────────────────────────┐  │
│ │     [Send Money]    [Request Money]      │  │
│ │     [    →         ]  [    ←←    ]       │  │
│ └──────────────────────────────────────────┘  │
│                                                 │
│  QUICK ACTIONS:                                │
│  ☐ Send to recent: Fatima Khan ৳2500          │
│  ☐ Pending requests: 1                        │
│                                                 │
│  RECENT TRANSACTIONS:                          │
│  ├─ Received ৳2500 from Rana Ahmed, 2h ago    │
│  ├─ Sent ৳1200 to Arjun Roy, 5h ago           │
│  ├─ Request from Arjun (৳500) PENDING, 1d ago │
│  └─ [View All Transactions →]                  │
│                                                 │
│  NOTIFICATIONS:                                │
│  • Received ৳2500 from Rana Ahmed (2h ago)    │
│  • Arjun requested ৳1200 (5h ago)             │
│                                                 │
└────────────────────────────────────────────────┘
```

**Actions:**
- Tap "Send Money" → Navigate to Send screen
- Tap "Request Money" → Navigate to Request screen
- Tap "Pending Requests" → Show money requests
- Tap transaction → Show details
- Tap "View All" → Show full history

**States:**
- Loading: Show spinner, "Fetching your balance..."
- Error: "Could not load balance. [Retry]"
- Empty: "No transactions yet. Start by sending or requesting money."

---

### Send Money Screen

**Step 1: Recipient Selection**

```
┌────────────────────────────────────────┐
│ Send Money                         [←] │
├────────────────────────────────────────┤
│                                        │
│  Who are you sending to?               │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │ 🔍 Search or enter name...       │ │
│  └──────────────────────────────────┘ │
│                                        │
│  RECENT / FAVORITES:                   │
│  ├─ Fatima Khan                       │
│  ├─ Arjun Roy                         │
│  └─ Nasrin Begum                      │
│                                        │
│  ALL USERS:                            │
│  ├─ [Rana Ahmed] (matching search)    │
│  ├─ [Rani Ahmad] (matching search)    │
│  └─ [See more...]                    │
│                                        │
└────────────────────────────────────────┘
```

**Step 2: Amount Input**

```
┌────────────────────────────────────────┐
│ Send Money to Fatima Khan          [←] │
├────────────────────────────────────────┤
│                                        │
│  How much?                             │
│                                        │
│  Your balance: ৳47,500.00              │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │ ৳ │                              │ │
│  └──────────────────────────────────┘ │
│     └─ (Enter amount, e.g., 2500)     │
│                                        │
│  Quick presets:                        │
│  [৳500] [৳1000] [৳2500] [৳5000]      │
│                                        │
│  Add a note (optional):                │
│  ┌──────────────────────────────────┐ │
│  │ Lunch money                      │ │
│  │ (Max 500 characters)             │ │
│  └──────────────────────────────────┘ │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │       [Confirm Transfer]         │ │
│  └──────────────────────────────────┘ │
│                                        │
└────────────────────────────────────────┘
```

**Step 3: Confirmation**

```
┌────────────────────────────────────────┐
│ Confirm Transfer                   [←] │
├────────────────────────────────────────┤
│                                        │
│  Please review:                        │
│                                        │
│  FROM:       You (Rana Ahmed)          │
│  TO:         Fatima Khan               │
│  AMOUNT:     ৳2,500.00                 │
│  NOTE:       Lunch money               │
│  FEE:        ৳0.00 (No fees)          │
│  TOTAL:      ৳2,500.00                 │
│                                        │
│  ⚠ This transfer is final and cannot   │
│    be reversed.                        │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │    [YES, SEND]   [NO, CANCEL]    │ │
│  └──────────────────────────────────┘ │
│                                        │
└────────────────────────────────────────┘
```

**Step 4: Processing**

```
┌────────────────────────────────────────┐
│ Processing...                      [✓] │
├────────────────────────────────────────┤
│                                        │
│  Sending ৳2,500.00 to Fatima Khan...   │
│                                        │
│  ⏳  [████████░░░░░░░░░░░░] 40%        │
│                                        │
│  This usually takes less than 10 sec   │
│                                        │
│  Do not close this screen.             │
│                                        │
└────────────────────────────────────────┘
```

**Step 5: Success**

```
┌────────────────────────────────────────┐
│ Transfer Completed                     │
├────────────────────────────────────────┤
│                                        │
│  ✓ Your transfer has been sent!        │
│                                        │
│  Transaction ID: TXN-20260829-ABC123   │
│                                        │
│  Amount: ৳2,500.00                     │
│  Sent to: Fatima Khan                  │
│  Date: 29 Aug 2026, 2:32 PM            │
│                                        │
│  Your new balance: ৳45,000.00           │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │  [View Receipt]  [Back to Home]  │ │
│  └──────────────────────────────────┘ │
│                                        │
│  Fatima Khan will receive a            │
│  notification about this transfer.     │
│                                        │
└────────────────────────────────────────┘
```

**Step 5 (Alternative): Failure**

```
┌────────────────────────────────────────┐
│ Transfer Failed                        │
├────────────────────────────────────────┤
│                                        │
│  ✗ Your transfer could not be sent.    │
│                                        │
│  REASON:                               │
│  Insufficient balance                  │
│                                        │
│  You tried to send: ৳2,500.00           │
│  Your balance: ৳1,500.00                │
│                                        │
│  Your balance has not changed.         │
│                                        │
│  OPTIONS:                              │
│  [Reduce Amount]  [Back to Home]       │
│                                        │
│  Transaction ID: TXN-20260829-ABC123   │
│  (if needed for support)               │
│                                        │
└────────────────────────────────────────┘
```

---

### Money Request Flow

**Similar to Send Money but:**
- Title: "Request Money"
- Label: "How much do you want to request?"
- Confirmation: "You are requesting ৳1,200 from Arjun Roy"
- Success: "Request sent to Arjun Roy. You'll be notified when they respond."
- Note field: "Reason" instead of just "Note"

---

### Transaction Details Screen

```
┌────────────────────────────────────────┐
│ Transaction Details                [←] │
├────────────────────────────────────────┤
│                                        │
│  ✓ COMPLETED                           │
│                                        │
│  Type:        Transfer (You sent)      │
│  Transaction: TXN-20260829-ABC123      │
│  Date:        29 Aug 2026, 2:32 PM     │
│  Status:      Completed                │
│                                        │
│  DETAILS:                              │
│  ├─ FROM:     Rana Ahmed (You)         │
│  ├─ TO:       Fatima Khan              │
│  ├─ Amount:   ৳2,500.00                │
│  ├─ Note:     Lunch money              │
│  └─ Fee:      ৳0.00                    │
│                                        │
│  BALANCE IMPACT:                       │
│  ├─ Before: ৳50,000.00                 │
│  ├─ After:  ৳47,500.00                 │
│  └─ Change: -৳2,500.00                 │
│                                        │
│  [Share ID] [Download Receipt]         │
│                                        │
└────────────────────────────────────────┘
```

---

### Transaction History Screen

```
┌────────────────────────────────────────┐
│ Transaction History                [⋯] │
├────────────────────────────────────────┤
│                                        │
│  Filter: [All ▼] [All statuses ▼]     │
│  [Date range: Custom ▼]                │
│                                        │
│  TRANSACTIONS:                         │
│                                        │
│  29 Aug 2026                           │
│  ├─ ✓ Received ৳2,500                 │
│  │   from Rana Ahmed, 2h ago           │
│  │   "Lunch money"                    │
│  │                                    │
│  └─ ✓ Sent ৳1,200                     │
│      to Arjun Roy, 5h ago              │
│      "Request approved"                │
│                                        │
│  28 Aug 2026                           │
│  ├─ ◐ Request PENDING                  │
│  │   from Arjun Roy, 1d ago            │
│  │   Requesting ৳500                   │
│  │                                    │
│  └─ ✓ Sent ৳100                       │
│      to Nasrin Begum, 1d ago           │
│                                        │
│  [Load More...]                        │
│                                        │
└────────────────────────────────────────┘
```

---

### Money Requests Screen

```
┌────────────────────────────────────────┐
│ Money Requests                     [⋯] │
├────────────────────────────────────────┤
│                                        │
│  [Received] [Sent]                     │
│                                        │
│  RECEIVED (3):                         │
│  ├─ Arjun Roy requested ৳500          │
│  │  Reason: Movie tickets              │
│  │  [Approve] [Reject]                 │
│  │                                    │
│  ├─ Nasrin Begum requested ৳1,200     │
│  │  Reason: Birthday gift              │
│  │  [Approve] [Reject]                 │
│  │                                    │
│  └─ Rafa Islam requested ৳2,500       │
│     Reason: Rent                       │
│     [Approve] [Reject]                 │
│                                        │
│  SENT (1):                             │
│  ├─ You requested ৳1,500              │
│    from Fatima Khan                    │
│    Reason: Lunch                       │
│    Status: PENDING (Since 1d ago)      │
│    [Cancel Request]                    │
│                                        │
└────────────────────────────────────────┘
```

---

### Profile/Account Screen

```
┌────────────────────────────────────────┐
│ Profile                            [←] │
├────────────────────────────────────────┤
│                                        │
│  👤 Rana Ahmed                         │
│                                        │
│  EMAIL: rana@example.com               │
│  JOINED: 29 August 2026                │
│  ACCOUNT STATUS: Active                │
│                                        │
│  SECURITY:                             │
│  ┌──────────────────────────────────┐ │
│  │  [Change Password]               │ │
│  └──────────────────────────────────┘ │
│                                        │
│  ACCOUNT:                              │
│  ┌──────────────────────────────────┐ │
│  │  [View All Transactions]         │ │
│  │  [Download Transaction History]  │ │
│  │  [Clear Notifications]           │ │
│  └──────────────────────────────────┘ │
│                                        │
│  APP:                                  │
│  ┌──────────────────────────────────┐ │
│  │  [Settings]  [Help]  [Logout]    │ │
│  └──────────────────────────────────┘ │
│                                        │
└────────────────────────────────────────┘
```

---

## 17. TRANSACTION CONFIRMATION UX

### Before Execution: Confirmation Screen

**Mandatory display before transfer:**
```
Review Transfer

Recipient:    Fatima Khan
Amount:       ৳2,500.00
Fee:          ৳0 (No fees for you)
From Account: Your Wallet
Note:         Lunch money

⚠ WARNING: This action cannot be undone.
  Money will be sent immediately.

[YES, SEND] [CANCEL]
```

**Requirements:**
- Must show exact recipient name
- Must show exact amount
- Must confirm user intent
- Must warn irreversibility
- Must use clear action buttons (not "OK" / "Submit")

### Duplicate Action Prevention

**After clicking "SEND":**
1. Confirmation screen replaced with processing screen
2. Send button disabled
3. If user double-clicks:
   - Server returns 409 CONFLICT (duplicate idempotency key)
   - UI shows: "Transfer already in progress"
   - Do NOT allow second submission

**After completion:**
1. Processing screen shows result
2. Screen auto-refreshes after 3 seconds
3. If user clicks "Back" before auto-refresh:
   - Navigates away
   - Transaction continues in background
   - User can query status later

### After Execution: Result Screen

```
SUCCESSFUL TRANSFER

✓ Transaction Completed
  Amount: ৳2,500.00
  Recipient: Fatima Khan
  Date: 29 Aug 2026, 2:32 PM
  Transaction ID: TXN-20260829-ABC123

  Your balance after transfer: ৳47,500.00

  [View Receipt] [Share ID] [Done]
```

**Must include:**
- Clear success indicator (✓)
- Exact amount
- Recipient
- Transaction ID (copiable)
- Updated balance
- Options to view details or dismiss

**For failures:**
```
TRANSFER FAILED

✗ Transfer Could Not Be Sent
  Reason: Insufficient Balance
  
  Amount requested: ৳2,500
  Your balance: ৳1,500
  
  Your balance has not changed.
  
  [Try with different amount] [Back to Home]
  
  Transaction ID: TXN-20260829-ABC123
  (Contact support if you need help)
```

---

## 18. SYSTEM ARCHITECTURE

### Architectural Overview

```
┌─────────────────────────────────────────────────────┐
│                   CLIENT LAYER                       │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Web Browser  │  │ Mobile App   │                 │
│  │ (React/Vue)  │  │ (React Native│                 │
│  │              │  │  or Flutter) │                 │
│  └──────┬───────┘  └───────┬──────┘                 │
│         │                   │                        │
└────────┼───────────────────┼────────────────────────┘
         │ HTTPS             │ HTTPS
         │                   │
┌────────▼───────────────────▼────────────────────────┐
│            API GATEWAY / LOAD BALANCER              │
│  (Kong, Nginx, or Cloud Provider LB)               │
└────────┬─────────────────────────────────────────────┘
         │
┌────────▼─────────────────────────────────────────────┐
│                BACKEND SERVICES (STATELESS)          │
│  ┌────────────────────────────────────────────────┐ │
│  │ Authentication Service                         │ │
│  │ - Register, Login, Token validation           │ │
│  │ - Password hashing, session mgmt              │ │
│  │ - Rate limiting (brute-force protection)      │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ Wallet Service                                 │ │
│  │ - Balance retrieval                            │ │
│  │ - Account management                          │ │
│  │ - User search                                  │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ Transfer/Transaction Service (CRITICAL)       │ │
│  │ - Transfer creation & execution               │ │
│  │ - Atomic database transactions                │ │
│  │ - Balance verification & locking              │ │
│  │ - Idempotency handling                        │ │
│  │ - Ledger entry creation                       │ │
│  │ - Status tracking                             │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ Money Request Service                          │ │
│  │ - Request creation                             │ │
│  │ - Approval/rejection                           │ │
│  │ - Transfer delegation                          │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ Notification Service (Async)                   │ │
│  │ - Push notifications                           │ │
│  │ - Email notifications                          │ │
│  │ - Best-effort delivery                         │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ History/Query Service                          │ │
│  │ - Transaction history retrieval                │ │
│  │ - Ledger queries                               │ │
│  │ - Search & filtering                           │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  All services: Horizontally scalable               │
│  All services: Stateless (no session state)        │
│  All services: Parallel deployment                 │
└────────┬─────────────────────────────────────────────┘
         │
┌────────▼─────────────────────────────────────────────┐
│              SHARED DATA LAYER                       │
│  ┌────────────────────────────────────────────────┐ │
│  │ Primary Database (PostgreSQL/MySQL)            │ │
│  │ ├─ Users table                                 │ │
│  │ ├─ Wallets table (balance)                    │ │
│  │ ├─ Transfers table (transactions)             │ │
│  │ ├─ Ledger entries table                       │ │
│  │ ├─ Money requests table                       │ │
│  │ ├─ Idempotency records table                  │ │
│  │ └─ Notifications table                        │ │
│  │                                               │ │
│  │ ACID guarantees: ✓ (SERIALIZABLE isolation)   │ │
│  │ Row-level locking: ✓                          │ │
│  │ Constraints: ✓ (balance non-negative, etc)    │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ Cache (Redis) - Optional for MVP               │ │
│  │ ├─ User sessions                               │ │
│  │ ├─ Balance cache (10-second TTL)               │ │
│  │ ├─ User search index                           │ │
│  │ └─ Rate limit counters                        │ │
│  └────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────┐ │
│  │ Read Replica (Optional for MVP)                │ │
│  │ ├─ Querying transaction history                │ │
│  │ ├─ Searching users                             │ │
│  │ ├─ Reporting/analytics                         │ │
│  │ └─ Does NOT handle writes (read-only)          │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Architecture Rationale

**Why NOT Microservices (for MVP)?**
- **Complexity:** Distributed transactions, service-to-service calls
- **Latency:** Network round-trips between services
- **Debugging:** Harder to trace transactions across services
- **Deployment:** More moving parts, harder to manage
- **Correctness:** Higher risk of race conditions at service boundaries

**Why Monolith with Services (for Hackathon)?**
- **Simplicity:** Single deployment unit, single database
- **Speed:** No inter-service network calls
- **Correctness:** Easier to maintain ACID transaction guarantees
- **Debugging:** Single application, unified logs
- **Scalability:** Horizontal scaling via load balancer (multiple instances)

**MVP Deployment:**
```
Load Balancer
├─ Instance 1: Full application (all services + DB driver)
├─ Instance 2: Full application (all services + DB driver)
├─ Instance 3: Full application (all services + DB driver)
└─ Database: Single PostgreSQL instance (can add replicas later)
```

**Each instance is stateless** → Can kill/restart without affecting others.

**Evolution to Microservices (Future):**
When scaling becomes necessary (100K+ concurrent users):
```
Service 1: Auth (independent auth service)
Service 2: Transfer Engine (dedicated transaction service)
Service 3: History Query (read-optimized service)
Service 4: Notifications (async notification service)
Shared: Database cluster (with replication/sharding)
Message Queue: Event bus (for async communication)
```

---

## 19. SCALABILITY

### MVP Scope (6-Hour Hackathon)

**Targets:**
- 100–1000 concurrent users
- 100 transfers/minute
- Single application instance
- Single database instance (PostgreSQL on powerful machine)
- All features working perfectly within this scale

**Architecture:**
```
Single monolithic application
↓
PostgreSQL database
↓
Suitable for hackathon demo
```

### Scaling Path (3-Year Vision to 10M+ Users)

#### Phase 1: Horizontal Backend Scaling (Current)
```
Load Balancer (nginx, HAProxy, or cloud LB)
├─ Instance 1: App
├─ Instance 2: App
├─ Instance 3: App
└─ (Scale to 100+ instances)
Single Database: PostgreSQL (master)
```
**Improvement:** 10K → 100K concurrent users

#### Phase 2: Database Read Scaling
```
Backends (100+ instances)
├─ Writes: Master database
├─ Reads: Read replicas (for history queries)
└─ Cache layer (Redis) for hot data
```
**Improvement:** 100K → 1M concurrent users

#### Phase 3: Database Partitioning (Sharding)
```
Backends (1000+ instances)
├─ Partition by user_id_hash % shard_count
├─ Shard 1: DB instance (users 0-999K)
├─ Shard 2: DB instance (users 1M-1.9M)
├─ Shard N: DB instance (users ...)
└─ Each shard: master + read replicas
```
**Improvement:** 1M → 10M+ concurrent users

**Note:** Each shard independently maintains ACID/atomicity for transfers within that shard.

#### Phase 4: Event-Driven Async Processing
```
Transfers (fast path):
├─ Synchronous: Atomic debit/credit
├─ Async: Notifications, analytics, auditing

Separated concerns:
├─ Core transaction: Ultra-fast, guaranteed correct
├─ Notifications: Eventually delivered, non-critical
└─ Analytics: Background batch jobs
```

### Performance Optimization (MVP-Ready)

**Database Indexes** (critical for MVP):
```sql
-- Prevent slow queries
CREATE INDEX idx_wallet_user_id ON wallets(user_id);
CREATE INDEX idx_transfer_sender ON transfers(sender_id, created_at DESC);
CREATE INDEX idx_transfer_receiver ON transfers(receiver_id, created_at DESC);
CREATE INDEX idx_transfer_idempotency ON transfers(sender_id, idempotency_key);
CREATE INDEX idx_ledger_user_date ON ledger_entries(user_id, created_at DESC);
CREATE INDEX idx_request_requestee ON money_requests(requestee_id, status, created_at DESC);
```

**Connection Pooling** (essential):
- Reuse database connections (don't create per request)
- Min connections: 20, Max: 100 (tunable)
- Tool: PgBouncer (PostgreSQL), or connection pool in app framework

**Caching** (optional for MVP):
```
Cache user search results: 5 minutes
Cache balance: 10 seconds (stale OK, refreshed on next write)
Cache user profile: 30 seconds
Invalidate on write
```

**Query Optimization:**
```
SELECT * FROM transfers 
WHERE user_id = $1 
ORDER BY created_at DESC 
LIMIT 20 OFFSET 0;

-- Good: Indexed on (user_id, created_at)
-- Returns 20 rows per page efficiently
```

**Transaction Optimization:**
- Keep transactions short (< 1 second)
- Acquire locks at start, release at end
- Avoid nested transactions
- Avoid blocking on external services (notifications async)

### Load Testing (Pre-Hackathon Submission)

**Test scenarios:**
1. **Normal load:** 50 concurrent users, 10 transfers/min → Should handle smoothly
2. **Spike:** 500 concurrent users, 100 transfers/min → Should not crash, may queue
3. **Stress:** 1000 concurrent users, 200 transfers/min → May degrade, but should not lose data
4. **Concurrency:** 100 simultaneous transfers on same account → Must prevent overdraft

---

## 20. OBSERVABILITY

### Structured Logging

**Every request:**
```json
{
  "timestamp": "2026-08-29T14:32:15.123Z",
  "request_id": "req-20260829-1234567890",
  "user_id": "uuid-xyz",
  "method": "POST",
  "endpoint": "/transfers",
  "status": 202,
  "duration_ms": 145,
  "payload_size": 256
}
```

**Every transfer:**
```json
{
  "timestamp": "2026-08-29T14:32:15.123Z",
  "transfer_id": "TXN-20260829-XXXX",
  "event": "transfer_created",
  "sender_id": "uuid-sender",
  "receiver_id": "uuid-receiver",
  "amount_paisa": 250000,
  "idempotency_key": "req-...",
  "status": "PROCESSING"
}

{
  "timestamp": "2026-08-29T14:32:18.123Z",
  "transfer_id": "TXN-20260829-XXXX",
  "event": "transfer_completed",
  "sender_balance_after": 47500000,
  "receiver_balance_after": 102500000,
  "ledger_entries_created": 2
}
```

**Every authentication:**
```json
{
  "timestamp": "2026-08-29T14:32:15.123Z",
  "event": "login_attempt",
  "email": "rana@...",
  "success": true,
  "user_id": "uuid-xyz",
  "ip_address": "192.168.1.1"
}
```

**Every error:**
```json
{
  "timestamp": "2026-08-29T14:32:15.123Z",
  "request_id": "req-20260829-1234567890",
  "level": "ERROR",
  "error_code": "INSUFFICIENT_BALANCE",
  "error_message": "Sender balance insufficient",
  "context": {
    "sender_id": "uuid-xyz",
    "required": 250000,
    "available": 150000
  }
}
```

### Transaction Traceability

**Golden Path:** User initiates transfer → system logs every step

```
14:32:15.001 [INFO] req-xxx: Transfer initiated
            sender=user-a, receiver=user-b, amount=250000

14:32:15.005 [INFO] req-xxx: Idempotency check passed
            key=req-user-a-..., new=true

14:32:15.010 [INFO] req-xxx: Input validation passed
            sender_exists=true, receiver_exists=true, amount_valid=true

14:32:15.015 [INFO] req-xxx: Transaction begun (SERIALIZABLE isolation)
            transfer_id=TXN-xxx

14:32:15.020 [INFO] req-xxx: Sender wallet locked
            balance_before=50000000

14:32:15.025 [INFO] req-xxx: Sender balance verified
            required=250000, available=50000000, ok=true

14:32:15.030 [INFO] req-xxx: Sender debited
            balance_after=49750000

14:32:15.035 [INFO] req-xxx: Receiver wallet locked
            balance_before=100000000

14:32:15.040 [INFO] req-xxx: Receiver credited
            balance_after=100250000

14:32:15.045 [INFO] req-xxx: Transfer marked COMPLETED
            transfer_status=COMPLETED

14:32:15.050 [INFO] req-xxx: Transaction committed

14:32:15.055 [INFO] req-xxx: Notification queued (async)
            receiver=user-b, type=TRANSFER_RECEIVED

14:32:15.060 [INFO] req-xxx: Response sent
            status=202, duration_ms=59
```

**If something fails:**
```
14:32:15.025 [ERROR] req-xxx: Sender balance insufficient
            required=250000, available=15000
14:32:15.030 [INFO] req-xxx: Transaction rolled back
14:32:15.035 [INFO] req-xxx: Transfer marked FAILED
            failure_reason=INSUFFICIENT_BALANCE
14:32:15.040 [INFO] req-xxx: Response sent
            status=402, error=INSUFFICIENT_BALANCE
```

### Audit Trail

**Immutable audit log** (append-only):
```
ID      | Timestamp           | Event Type | User ID | Transfer ID | Details
--------|---------------------|-----------|--------|------------|----------
1       | 2026-08-29 14:32:15 | CREATE    | user-a | TXN-xxx    | Transfer initiated
2       | 2026-08-29 14:32:18 | COMPLETE  | system | TXN-xxx    | Transfer completed
3       | 2026-08-29 14:33:00 | QUERY     | user-a | TXN-xxx    | User viewed transaction
...
```

**Used for:**
- Compliance: Prove transactions happened
- Debugging: "User says money disappeared" → Check audit log
- Security: Detect suspicious patterns

### Request IDs

**Every request gets unique ID:**
```
req-[user_id]-[timestamp]-[random]
req-user-a-20260829143215-a7k9x2

User can share this ID with support:
"My transfer failed. Request ID: req-user-a-20260829143215-a7k9x2"

Support can search logs for this ID and see entire transaction flow.
```

### Health Checks

**System health:**
```
GET /health
Response:
{
  "status": "healthy",
  "database": "connected",
  "cache": "connected",
  "notification_queue": "ok",
  "timestamp": "2026-08-29T14:32:15Z"
}
```

**Metrics to monitor:**
- Response latency (p50, p95, p99)
- Error rate (errors / total requests)
- Database connection pool utilization
- Transaction success rate
- Transfer completion time

---

## 21. FAILURE SCENARIOS

### Comprehensive Failure Handling Table

| Scenario | User Action | Expected System Behavior | Data Consistency |
|----------|-------------|-------------------------|-------------------|
| **Insufficient Balance** | User sends ৳2,500 with balance ৳1,500 | Error immediately: "Insufficient balance. Your balance: ৳1,500" | Balance unchanged ✓ |
| **Invalid Recipient** | User searches for non-existent user | Search returns no results, send blocked | No transfer created ✓ |
| **Duplicate Send (Double-Click)** | User clicks Send twice in <1 second | First click processes, second click shows "Already in progress" | Only one transfer ✓ |
| **Browser Retry** | Network times out, browser auto-retries | Idempotency key prevents duplicate, returns same result as before | No duplicate ✓ |
| **Network Timeout** | Transfer in flight, network drops | Server continues processing, client shows "Checking status..." | Eventually consistent ✓ |
| **Backend Crashes** | Transfer mid-execution → server dies | Database transaction rolls back automatically, wallet restored | All-or-nothing ✓ |
| **Database Connection Lost** | Active query → DB connection dies | Connection error caught, transaction rolled back, retry available | No partial state ✓ |
| **Concurrent Transfers (Overdraft)** | Two simultaneous sends from same account: ৳8,000 + ৳7,000, balance ৳10,000 | First succeeds, second fails with "Insufficient balance" | No overdraft ✓ |
| **Notification Service Down** | Transfer completes but notifications unreachable | Transfer COMPLETED (immutable), notification retried async | Transaction consistent, notification eventual ✓ |
| **User Deleted Mid-Transfer** | Receiver account deleted between request and execution | Transfer fails, sender refunded, clear error: "Recipient no longer exists" | Money not lost ✓ |
| **Receiver Account Suspended** | Transfer to suspended account | Fails immediately with "Recipient account inactive" | No transfer ✓ |
| **Request Timeout (>30 sec)** | Client makes transfer, server takes 45 seconds | Client times out, shows "Uncertain status", user can check by transaction ID | System state knowable ✓ |
| **User Refreshes During Transfer** | User navigates away during processing screen | Transfer continues in background, user can check later in history | No duplicate ✓ |
| **Invalid Amount Input** | User enters "abc" or "-500" | Validation fails, error shown, no submission | No transfer created ✓ |
| **Idempotency Key Collision** | Two different users use same idempotency key (shouldn't happen) | Treated as different transactions (key scoped to user), processed independently | Correct ✓ |
| **Ledger Entry Creation Fails** | Insert into ledger_entries fails (disk full) | Transfer marked FAILED, transaction rolled back, wallet consistent | No partial ledger ✓ |
| **Transfer Record Exists, Ledger Missing** (Recovery scenario) | System detects mismatch on audit | Alert raised, operators investigate, can manually reconcile | Detectable, actionable ✓ |
| **Rate Limit Exceeded** | User sends >10 transfers/minute | 429 Too Many Requests, retry after 60 seconds | No transfer attempted ✓ |
| **Session Expires** | Transfer in progress, session token expires | Request rejected, user logs back in, can retry with idempotency key | Safe restart ✓ |
| **Email Already Registered** | User registers with existing email | 409 Conflict, clear message: "Email already in use. Try logging in." | No duplicate account ✓ |
| **Password Too Weak** | User registers with password "123" | 422 Unprocessable Entity, error: "Password too weak" | Account not created ✓ |

---

## 22. SYSTEM INVARIANTS

**An invariant is a condition that must ALWAYS be true, enforced at all costs.**

### Invariant 1: Atomicity of Transfers
```
INVARIANT: A completed transfer has EXACTLY one debit and one credit.

ENFORCEMENT:
- Database: SERIALIZABLE transaction
- No partial updates
- If credit fails, debit rolled back
- If debit fails, transfer marked FAILED (no credit attempted)
```

### Invariant 2: Balance Non-Negativity
```
INVARIANT: No user's balance shall ever be negative.

ENFORCEMENT:
- Database constraint: CHECK (balance_paisa >= 0)
- Pre-flight validation: Balance check before debit
- Row-level locking: Prevents concurrent overdraft
- If any transaction would violate, entire transaction rolled back
```

### Invariant 3: Closed System Money Conservation
```
INVARIANT: Sum of all user balances = Initial total money
           (accounting for closed accounts and corrections)

ENFORCEMENT:
- Ledger entries: Every debit matched by corresponding credit
- Audit verification: Periodic check that sum(balances) = expected
- If mismatch detected: CRITICAL alert, investigation required
```

### Invariant 4: Transfer Immutability
```
INVARIANT: A completed transfer cannot change.

ENFORCEMENT:
- Transfer record: status = COMPLETED is terminal
- No API to modify completed transfer
- No admin override (in MVP)
- Code review: Ensure no update on completed transfers
```

### Invariant 5: Unique Transaction IDs
```
INVARIANT: Every completed transfer has globally unique ID.

ENFORCEMENT:
- Generate UUID (guaranteed unique)
- Database unique constraint
- Code: Never reuse transfer IDs
```

### Invariant 6: Consistency Between Sender & Receiver Views
```
INVARIANT: If User A sees "Transfer to B: ৳X completed",
           User B sees "Transfer from A: ৳X received".

ENFORCEMENT:
- Same ledger entries used for both views
- Queries join on transfer_id
- Both see same timestamp
- Testing: Verify views match
```

### Invariant 7: No Idempotent Duplication
```
INVARIANT: The same idempotency key cannot execute twice.

ENFORCEMENT:
- Idempotency record stored before execution
- Unique constraint: (user_id, idempotency_key)
- Before execute: Check if key exists
- If exists: Return cached result
- If not: Mark as PROCESSING, execute, cache result
```

### Invariant 8: Request Status Correctness
```
INVARIANT: Money request can only be in ONE final state.

ENFORCEMENT:
- Status enum: PENDING, APPROVED, REJECTED, CANCELLED, EXPIRED
- No transitions between terminal states
- UPDATE only if current_status = expected_status
- Database constraint if needed
```

### Invariant 9: No Self-Transfers
```
INVARIANT: A user cannot transfer to themselves.

ENFORCEMENT:
- Validation: sender_id ≠ receiver_id
- Database constraint: CHECK (sender_id != receiver_id)
- UI prevention: Cannot select self as recipient
- API validation: Explicit check before processing
```

### Invariant 10: User Uniqueness
```
INVARIANT: Email addresses are globally unique.

ENFORCEMENT:
- Database unique constraint: UNIQUE (email)
- Registration validation: Check email exists
- No two accounts with same email
```

---

## 23. MVP vs FUTURE

### MVP (6-Hour Hackathon)

| Feature | MVP | Reason |
|---------|-----|--------|
| User registration | ✓ Yes | Core feature, needed for every user |
| User login | ✓ Yes | Authentication required for all actions |
| View balance | ✓ Yes | Foundation for all transactions |
| Send money | ✓ Yes | Primary use case |
| Money requests | ✓ Yes | Mentioned in challenge, important UX |
| Transaction history | ✓ Yes | Trust & transparency, required |
| Transaction details | ✓ Yes | Users need to verify transactions |
| Notifications (in-app) | ✓ Yes | Users need to know about money received |
| Search users | ✓ Yes | Need to find recipients |
| Concurrent transfer safety | ✓ Yes | Critical correctness requirement |
| Idempotency / duplicate prevention | ✓ Yes | Critical correctness requirement |
| Transaction status tracking | ✓ Yes | Users need clear feedback |
| API for all operations | ✓ Yes | Necessary for mobile/web compatibility |
| Basic security (password hashing) | ✓ Yes | Minimum viable security |
| Rate limiting | ✓ Yes | Prevent abuse & brute-force |
| Error messages | ✓ Yes | Users need clear feedback |
| Responsive UI | ✓ Yes | Should work on mobile |
| Transaction immutability | ✓ Yes | Trust requirement |
| Atomic transfers | ✓ Yes | Correctness requirement |
| Ledger entries | ✓ Yes | Auditability, trust |
| Dashboard | ✓ Yes | Primary user interface |

### FUTURE (Post-Hackathon Enhancements)

| Feature | Future | Reason |
|---------|--------|--------|
| Push notifications | ⏳ Future | In-app is MVP, push is nice-to-have |
| Email notifications | ⏳ Future | Nice-to-have, not critical |
| Contacts/Favorites | ⏳ Future | QoL improvement, not essential |
| Transaction reversal | ⏳ Future | Dangerous (breaks trust), requires careful design |
| Dispute resolution | ⏳ Future | Requires admin interface, complex workflow |
| Scheduled transfers | ⏳ Future | Not mentioned in challenge |
| Recurring payments | ⏳ Future | Not mentioned in challenge |
| QR code payments | ⏳ Future | Nice-to-have, not critical |
| Peer groups / splitting | ⏳ Future | Complex, not mentioned in challenge |
| Merchant payments | ⏳ Future | Out of scope (closed ecosystem) |
| Multi-currency | ⏳ Future | Only BDT in MVP |
| Real payment integration | ⏳ Future | Out of scope (simulated funds only) |
| Advanced fraud detection | ⏳ Future | Simple rule-based checks could be MVP |
| Admin panel | ⏳ Future | Minimal admin access in MVP |
| User profile picture | ⏳ Future | Nice-to-have, no impact on functionality |
| Chat / messaging | ⏳ Future | Out of scope |
| Analytics dashboard | ⏳ Future | For operators (nice-to-have) |
| Two-factor authentication | ⏳ Future | Enhanced security (nice-to-have) |
| Transaction export (CSV) | ⏳ Future | Nice-to-have |
| Blockchain (if considering) | ⏳ Future | Not needed, SQL DB sufficient |

---

## 24. TECHNOLOGY STACK

### Frontend

**Primary: React or React Native**

| Tech | Purpose | Why Chosen |
|------|---------|-----------|
| React.js (Web) | Web UI | Fast iteration, large ecosystem, familiar |
| React Native (Mobile) | iOS + Android | Code sharing, reduced dev time |
| Or: Flutter (if team prefers) | Cross-platform mobile | Excellent performance, good for fast development |
| TypeScript | Type safety | Catches errors early, improves maintainability |
| Tailwind CSS | Styling | Rapid UI development, responsive design |
| Axios or Fetch API | HTTP client | API communication, error handling |
| Redux or Context API | State management | Complex state (user, transactions, wallet) |

### Backend

| Tech | Purpose | Why Chosen |
|------|---------|-----------|
| Node.js + Express | REST API server | Fast iteration, JavaScript/TypeScript, huge ecosystem |
| Or: Python + FastAPI | REST API server | Excellent for rapid development, clear syntax |
| Or: Go | REST API server | High performance, good for concurrency |
| **Chosen for Hackathon: Node.js + Express** | Balance of speed and reliability | |

### Database

| Tech | Purpose | Why Chosen |
|------|---------|-----------|
| PostgreSQL | Primary data store | ACID guarantees, row-level locking, JSON support, excellent for concurrency |
| Optional: Redis | Caching & sessions | Fast cache, connection pooling |

**Why PostgreSQL over MySQL?**
- Superior row-level locking (essential for concurrent transfers)
- Better transaction isolation levels (SERIALIZABLE fully supported)
- More reliable (older, proven in production)
- Slightly more complex, but worth it for correctness

### Supporting Services

| Tech | Purpose | Why Chosen |
|------|---------|-----------|
| Docker | Containerization | Consistent dev/prod environments, easy deployment |
| Docker Compose | Local orchestration | Quick local setup, all services in one command |
| Nginx / HAProxy | Load balancing | Distribute requests across backend instances |
| PgBouncer | Database connection pooling | Limit connections, improve performance |

### Development & Testing

| Tech | Purpose | Why Chosen |
|------|---------|-----------|
| Jest | Unit testing | Fast, simple, great for Node.js |
| Supertest | HTTP testing | Test API endpoints easily |
| K6 or JMeter | Load testing | Stress test the system |
| Git | Version control | Standard, essential |
| GitHub / GitLab | Repository | Collaboration, CI/CD |

### Deployment (Hackathon)

| Option | Setup Time | Reliability |
|--------|-----------|------------|
| Local laptop + VM | 30 min | Medium (for demo) |
| Docker on single server | 1 hour | High |
| Heroku (free tier) | 30 min | Medium (free tier limited) |
| AWS/GCP/Azure (free tier) | 1-2 hours | High |
| DigitalOcean | 1 hour | High, cheap ($5-10/month) |

**Recommendation for Hackathon:** Docker on a single cloud VM (DigitalOcean, AWS, GCP)

---

## 25. DEPLOYMENT

### Local Development Setup

```bash
# Prerequisites
- Node.js 18+
- PostgreSQL 12+
- Redis (optional)
- Docker & Docker Compose

# Clone repository
git clone https://github.com/team/moneyflow.git
cd moneyflow

# Environment variables
cp .env.example .env
# Edit .env with local settings:
DATABASE_URL=postgresql://user:pass@localhost:5432/moneyflow_dev
JWT_SECRET=your-super-secret-key
NODE_ENV=development

# Install dependencies
npm install

# Start services (with Docker Compose)
docker-compose up -d  # postgres, redis, optional api

# Migrations
npm run migrate:latest

# Seed test data (optional)
npm run seed

# Start development server
npm run dev
# Server running on http://localhost:3000
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/moneyflow
DB_POOL_MIN=10
DB_POOL_MAX=100

# Security
JWT_SECRET=randomsecretkey32charsormore
JWT_EXPIRATION=86400  # 24 hours in seconds

# Server
NODE_ENV=production
PORT=3000
API_URL=https://api.moneyflow.app

# Notifications (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=notifications@moneyflow.app
SMTP_PASS=apppassword

# Monitoring (optional)
SENTRY_DSN=https://...

# Rate Limiting
RATE_LIMIT_WINDOW=60000  # ms
RATE_LIMIT_MAX_REQUESTS=10
```

### Database Initialization

```bash
# Create database
createdb moneyflow

# Run migrations
npm run migrate:latest

# Verify structure
psql moneyflow -c "\dt"
# Output: List of tables

# Seed initial data
npm run seed:initial
# Creates admin, test users
```

### Docker Deployment

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/moneyflow
      REDIS_URL: redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: moneyflow
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

**Dockerfile:**
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

### Production Deployment

**Recommended: Separate VM for each component**

```
VM1: API Servers (x3 for redundancy)
  - Node.js + Express
  - Stateless (can scale horizontally)

VM2: PostgreSQL Database
  - Master database
  - Automated backups
  - Monitoring

VM3: Redis Cache (optional)
  - Session storage
  - Rate limit counters

Load Balancer (HAProxy / Nginx)
  - Distribute traffic to API servers
  - Health checks
  - SSL/TLS termination
```

**Deployment process:**
```bash
# 1. Build Docker image
docker build -t moneyflow:latest .
docker tag moneyflow:latest registry.company.com/moneyflow:latest
docker push registry.company.com/moneyflow:latest

# 2. Deploy to servers
ansible-playbook deploy.yml

# 3. Verify
curl https://api.moneyflow.app/health
# Should return: {"status": "healthy", ...}
```

### Health Monitoring

**Endpoint:**
```
GET /health
Returns: {"status": "healthy", "db": "ok", "timestamp": "..."}
```

**Monitoring tools:**
- Uptime checks (Pingdom, UptimeRobot)
- Log aggregation (ELK Stack, CloudWatch)
- Error tracking (Sentry)
- Performance monitoring (New Relic, Datadog)

---

## 26. TESTING STRATEGY

### Unit Tests

**Focus:** Logic that doesn't depend on external services

```javascript
// tests/unit/transfer.test.js

describe('Transfer Logic', () => {
  test('Should calculate correct balance after transfer', () => {
    const balance_before = 50000000;  // ৳500,000
    const transfer_amount = 25000000;  // ৳250,000
    const balance_after = balance_before - transfer_amount;
    expect(balance_after).toBe(25000000);  // ৳250,000
  });

  test('Should prevent negative balance', () => {
    const balance = 10000000;  // ৳100,000
    const transfer = 15000000;  // ৳150,000
    expect(() => {
      if (balance < transfer) throw new Error('INSUFFICIENT_BALANCE');
    }).toThrow('INSUFFICIENT_BALANCE');
  });

  test('Should validate transfer amount is positive', () => {
    const validate_amount = (amount) => {
      if (amount <= 0) throw new Error('INVALID_AMOUNT');
      return true;
    };
    expect(() => validate_amount(-1000)).toThrow('INVALID_AMOUNT');
    expect(() => validate_amount(0)).toThrow('INVALID_AMOUNT');
    expect(() => validate_amount(1000)).not.toThrow();
  });

  test('Should prevent self-transfer', () => {
    const validate_self = (sender_id, receiver_id) => {
      if (sender_id === receiver_id) throw new Error('SELF_TRANSFER');
      return true;
    };
    expect(() => validate_self('user-a', 'user-a')).toThrow('SELF_TRANSFER');
    expect(() => validate_self('user-a', 'user-b')).not.toThrow();
  });
});
```

### Integration Tests

**Focus:** APIs, database, transactions

```javascript
// tests/integration/transfer.integration.test.js

describe('Transfer API', () => {
  let sender_id, receiver_id;

  beforeAll(async () => {
    // Setup: Create test users
    sender_id = await create_user('sender@test.com', 50000000);  // ৳500,000
    receiver_id = await create_user('receiver@test.com', 20000000);  // ৳200,000
  });

  test('Should execute successful transfer', async () => {
    const response = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender_token}`)
      .send({
        receiver_id,
        amount_bdt: 2500.00,
        note: 'Test transfer'
      });

    expect(response.status).toBe(202);
    expect(response.body.data.status).toBe('PROCESSING');
    expect(response.body.data.transfer_id).toBeDefined();

    // Verify balances changed
    const sender_balance = await get_balance(sender_id);
    const receiver_balance = await get_balance(receiver_id);
    
    expect(sender_balance).toBe(47500000);  // ৳475,000
    expect(receiver_balance).toBe(22500000);  // ৳225,000
  });

  test('Should reject transfer with insufficient balance', async () => {
    const response = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${poor_user_token}`)
      .send({
        receiver_id,
        amount_bdt: 1000000.00  // More than balance
      });

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  test('Should prevent duplicate transfer via idempotency key', async () => {
    const idempotency_key = 'req-sender-20260829-1234';

    const response1 = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender_token}`)
      .set('Idempotency-Key', idempotency_key)
      .send({ receiver_id, amount_bdt: 1000.00 });

    const response2 = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender_token}`)
      .set('Idempotency-Key', idempotency_key)
      .send({ receiver_id, amount_bdt: 1000.00 });

    expect(response1.body.data.transfer_id).toBe(response2.body.data.transfer_id);
    // Same transfer ID = not duplicated
  });
});
```

### Concurrency Tests

**Critical:** Verify race condition prevention

```javascript
// tests/concurrency/concurrent_transfers.test.js

describe('Concurrent Transfers (Race Conditions)', () => {
  test('Should prevent overdraft with concurrent transfers', async () => {
    // Setup: User with ৳10,000 balance
    const user_id = await create_user('concurrent-test@test.com', 1000000);  // ৳10,000
    const receiver1 = await create_user('receiver1@test.com', 0);
    const receiver2 = await create_user('receiver2@test.com', 0);

    // Attempt two concurrent transfers
    const transfer1 = {
      sender_id: user_id,
      receiver_id: receiver1,
      amount_paisa: 800000  // ৳8,000
    };

    const transfer2 = {
      sender_id: user_id,
      receiver_id: receiver2,
      amount_paisa: 700000  // ৳7,000
    };

    // Fire both simultaneously (not sequentially)
    const [result1, result2] = await Promise.all([
      execute_transfer(transfer1),
      execute_transfer(transfer2)
    ]);

    // Exactly one should succeed
    const successful = [result1, result2].filter(r => r.status === 'COMPLETED');
    const failed = [result1, result2].filter(r => r.status === 'FAILED');

    expect(successful.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0].error).toBe('INSUFFICIENT_BALANCE');

    // Verify final balance is correct
    const final_balance = await get_balance(user_id);
    expect(final_balance).toBe(200000);  // ৳2,000 (only one transferred)
  });

  test('Should handle 50 concurrent transfers safely', async () => {
    const user_id = await create_user('stress-test@test.com', 10000000);  // ৳100,000
    const receivers = await Promise.all([
      ...Array(50).keys()
    ].map(i => create_user(`receiver-${i}@test.com`, 0)));

    // Create 50 concurrent transfer requests
    const transfers = receivers.map(receiver_id => ({
      sender_id: user_id,
      receiver_id,
      amount_paisa: 200000  // ৳2,000 each, total ৳100,000
    }));

    // Fire all 50 simultaneously
    const results = await Promise.all(
      transfers.map(t => execute_transfer(t))
    );

    // Exactly 50 should succeed, rest should fail
    const successes = results.filter(r => r.status === 'COMPLETED');
    expect(successes.length).toBe(50);

    // Verify balance = 0
    const final_balance = await get_balance(user_id);
    expect(final_balance).toBe(0);

    // Verify each receiver got ৳2,000
    for (const receiver_id of receivers) {
      const balance = await get_balance(receiver_id);
      expect(balance).toBe(200000);
    }
  });
});
```

### Idempotency Tests

```javascript
// tests/idempotency/idempotency.test.js

describe('Idempotency', () => {
  test('Should not duplicate transfer on retry with same idempotency key', async () => {
    const key = 'req-user-20260829-abc123';
    const transfer_data = {
      receiver_id: 'user-b',
      amount_bdt: 2500.00
    };

    // First attempt
    const result1 = await post_transfer_with_key(user_token, transfer_data, key);
    const transfer_id1 = result1.data.transfer_id;

    // Verify transfer succeeded
    expect(result1.status).toBe(202);

    // Second attempt (retry) with same key
    await delay(100);  // Simulate network delay
    const result2 = await post_transfer_with_key(user_token, transfer_data, key);
    const transfer_id2 = result2.data.transfer_id;

    // Should return same transfer ID
    expect(transfer_id2).toBe(transfer_id1);

    // Verify only one transfer in database
    const transfer_count = await db.query(
      'SELECT COUNT(*) FROM transfers WHERE id = $1',
      [transfer_id1]
    );
    expect(transfer_count).toBe(1);

    // Verify balance impact only once
    const balance = await get_balance(user_id);
    expect(balance).toBe(initial_balance - 250000);  // Only one transfer deducted
  });
});
```

### Failure Scenario Tests

```javascript
// tests/failure_scenarios/failure_handling.test.js

describe('Failure Scenarios', () => {
  test('Should rollback on receiver not found', async () => {
    const invalid_receiver_id = 'nonexistent-user-uuid';
    const response = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender_token}`)
      .send({
        receiver_id: invalid_receiver_id,
        amount_bdt: 2500.00
      });

    expect(response.status).toBe(404);

    // Verify sender balance unchanged
    const balance = await get_balance(sender_id);
    expect(balance).toBe(initial_balance);
  });

  test('Should handle database transaction rollback', async () => {
    // Simulate database failure during credit
    const mock_fail_on_credit = jest.spyOn(db, 'execute')
      .mockRejectedValueOnce(new Error('DB connection lost'));

    const response = await request(app)
      .post('/transfers')
      .set('Authorization', `Bearer ${sender_token}`)
      .send({
        receiver_id,
        amount_bdt: 2500.00
      });

    expect(response.status).toBe(500);

    // Verify both sender and receiver balances unchanged
    const sender_balance = await get_balance(sender_id);
    const receiver_balance = await get_balance(receiver_id);
    expect(sender_balance).toBe(initial_sender_balance);
    expect(receiver_balance).toBe(initial_receiver_balance);
  });
});
```

### Test Coverage Goals

- **Unit tests:** 80%+ coverage of business logic
- **Integration tests:** All API endpoints covered
- **Concurrency tests:** Main race condition scenarios
- **Failure tests:** All error paths
- **Total coverage target:** 70%+ (critical paths must be 90%+)

---

## 27. ACCEPTANCE CRITERIA

### Feature: User Registration

```gherkin
SCENARIO: Successful user registration
Given I am on the registration page
When I enter email "rana@example.com"
And I enter password "SecurePass123"
And I enter full name "Rana Ahmed"
And I click "Register"
Then my account is created
And I receive initial balance of ৳100,000
And I am logged in automatically
And I see my dashboard with balance "৳100,000.00"

SCENARIO: Duplicate email registration
Given a user with email "rana@example.com" already exists
When I attempt to register with the same email
Then I see error "Email already registered"
And no new account is created

SCENARIO: Weak password rejection
Given I enter password "123"
When I click "Register"
Then I see error "Password too weak. Use 8+ characters"
And account is not created
```

### Feature: Money Transfer

```gherkin
SCENARIO: Successful transfer
Given I have balance ৳50,000
And I want to send ৳2,500 to Fatima Khan
When I click "Send Money"
And I search for "Fatima Khan"
And I select her from results
And I enter amount "2500"
And I enter note "Lunch money"
And I review the confirmation screen
And I click "Confirm"
Then the system processes the transfer
And I see success message "Transfer completed"
And I see transaction ID "TXN-XXXX"
And my balance updates to "৳47,500"
And Fatima receives notification
And transaction appears in both our histories

SCENARIO: Transfer with insufficient balance
Given I have balance ৳1,500
When I attempt to send ৳2,500
Then I see error "Insufficient balance (available: ৳1,500)"
And my balance remains "৳1,500"
And no transfer is created

SCENARIO: Duplicate transfer prevention
Given I am on the confirmation screen
When I click "Send" button twice rapidly
Then only one transfer executes
And I see message "Transfer already in progress"
And my balance reflects only one deduction
And transaction history shows only one transfer

SCENARIO: Network timeout recovery
Given I click "Send" and network becomes unavailable
When I wait 30 seconds
And I check my balance and transaction history
Then I can see definitive state (COMPLETED or FAILED)
And balance is consistent with transaction history
And I can see transaction ID if transfer succeeded
```

### Feature: Money Requests

```gherkin
SCENARIO: Send and approve money request
Given I am user Rana
When I send a money request to Arjun for ৳1,200
Then Arjun sees the request in "Requests Received"
And I see the request in "Requests Sent" as PENDING

When Arjun approves the request
Then his balance decreases by ৳1,200
And my balance increases by ৳1,200
And request status changes to APPROVED
And transaction appears in both histories
And I receive notification "Request approved"

SCENARIO: Reject money request
Given I am Arjun and received a request for ৳1,200
When I click "Reject"
Then request status becomes REJECTED
And no transfer occurs
And Rana receives notification "Request rejected"
And balance is unchanged for both users

SCENARIO: Approve with insufficient balance
Given I received a request for ৳2,000
When I have balance ৳1,500
And I click "Approve"
Then I see error "Insufficient balance to approve"
And request remains PENDING
And no transfer occurs
```

### Feature: Transaction History

```gherkin
SCENARIO: View transaction history
Given I am logged in
When I navigate to "Transaction History"
Then I see all my transactions in reverse chronological order
And each transaction shows:
  - Amount with currency (৳X.XX)
  - Counterparty name
  - Status (COMPLETED, FAILED, etc.)
  - Timestamp
  - Transaction ID
  - Optional note

SCENARIO: View transaction details
Given I see a transaction in history
When I click on it
Then I see full details:
  - Transaction ID (unique, copyable)
  - Type (Transfer sent/received/request)
  - Counterparty full name
  - Amount (exact)
  - Status and timestamp
  - My balance before and after
  - Note (if any)
  - Link to share transaction ID

SCENARIO: Filter transaction history
Given I am viewing my transactions
When I filter by type "TRANSFER_SENT"
And filter by status "COMPLETED"
And filter by date range "Last 7 days"
Then history shows only transfers I sent that completed in last 7 days
And pagination works correctly
```

### Feature: Concurrency Safety

```gherkin
SCENARIO: Concurrent transfers with limited balance
Given user A has balance ৳10,000
When two transfers are initiated simultaneously:
  - Transfer 1: Send ৳8,000 to user B
  - Transfer 2: Send ৳7,000 to user C
Then exactly one succeeds and one fails (not both succeed)
And final balance is correct (either ৳2,000 or ৳3,000)
And transaction history is consistent
And no overdraft occurs
```

### Feature: Idempotency

```gherkin
SCENARIO: Idempotent transfer (no duplicate on retry)
Given I initiated a transfer with idempotency key "KEY-123"
When I retry the same transfer with the same key
Then the system returns the same result as the first attempt
And no duplicate transfer is created
And balance is not double-deducted
And only one transaction appears in history
```

### Feature: API Correctness

```gherkin
SCENARIO: API returns correct error codes
Given various error conditions
When I call the API with invalid requests
Then I receive correct HTTP status codes:
  - 400: Bad Request (invalid format)
  - 401: Unauthorized (invalid token)
  - 402: Payment Required (insufficient balance)
  - 404: Not Found (user not found)
  - 409: Conflict (self-transfer, duplicate request)
  - 422: Unprocessable Entity (validation error)
  - 429: Too Many Requests (rate limit)
  - 500: Internal Server Error (server error)
```

---

## 28. DEMO SCENARIO (3-5 Minutes)

**Objective:** Demonstrate that this is NOT a simple CRUD app, but a robust money movement system.

### Scene 1: User Registration & Initial Balance
```
Title: "Setting up our demo"

ACTION:
- Register two users:
  User A: "rana@example.com" → Balance: ৳100,000
  User B: "fatima@example.com" → Balance: ৳100,000

SHOW:
- Both accounts created
- Initial balances displayed
- Clean, responsive UI

TIME: 30 seconds
```

### Scene 2: Normal Money Transfer
```
Title: "Normal Transfer - The Happy Path"

ACTION:
- User A sends ৳2,500 to User B
- Show confirmation screen (recipient, amount, note)
- User A clicks "Confirm"

SHOW:
- Processing animation (small delay for effect)
- Success screen with:
  * Transaction ID: TXN-20260829-ABC123
  * Amount: ৳2,500
  * Recipient: Fatima (User B)
  * Status: COMPLETED
  * New balance: ৳97,500

TIME: 45 seconds
```

### Scene 3: Transaction Verification
```
Title: "Trust Through Transparency"

ACTION:
- User A opens transaction details
- User B opens transaction history and sees received transaction

SHOW:
- Both users see consistent transaction data:
  * Same transaction ID
  * Same amount
  * Same timestamp
  * User A sees "-৳2,500"
  * User B sees "+৳2,500"
  * Balance impact is correct

NARRATIVE:
"Notice: Both users see the same transaction ID and amount. 
This transaction is immutable - it cannot be modified or duplicated."

TIME: 40 seconds
```

### Scene 4: The Hard Problem - Duplicate Prevention
```
Title: "The Problem: Double-Click"

ACTION:
- User A initiates another transfer
- Before it completes, user double-clicks the "Send" button
- Show what SHOULD happen vs WOULD happen in naive system

SHOW (Compare two scenarios):
NAIVE SYSTEM (wrong):
  ✗ First click: ৳2,500 deducted
  ✗ Second click: ৳2,500 deducted again
  ✗ Final balance: ৳92,500 (SHOULD BE ৳95,000)
  ✗ Money duplicated!

MONEYFLOW (correct):
  ✓ First click: Processes
  ✓ Second click: "Transfer already in progress" message
  ✓ Only ONE transfer executes
  ✓ Final balance: ৳95,000 (CORRECT)
  ✓ Single transaction ID: TXN-XXX (only one)

TECHNICAL EXPLANATION:
"We use idempotency keys: each request gets a unique ID.
If the same request arrives twice, the server ignores the duplicate."

TIME: 50 seconds
```

### Scene 5: The Harder Problem - Race Condition
```
Title: "The Hard Problem: Concurrent Transfers"

ACTION:
- Show a scenario:
  * User C has ৳10,000 balance
  * Simultaneously sends:
    - Transfer 1: ৳6,000 to User D
    - Transfer 2: ৳7,000 to User E
  * Fire both at exact same time

SHOW (Run the test):
NAIVE SYSTEM (wrong):
  ✗ Check 1: Balance ৳10,000 ≥ ৳6,000? YES → deduct ৳6,000
  ✗ Check 2: Balance ৳10,000 ≥ ৳7,000? YES → deduct ৳7,000
  ✗ RESULT: Final balance: ৳-3,000 OVERDRAFT! 
  ✗ DISASTER!

MONEYFLOW (correct):
  ✓ Transfer 1: Acquires database lock on balance
  ✓ Transfer 2: WAITS for lock
  ✓ Transfer 1: Verifies ৳10,000 ≥ ৳6,000 ✓ → deducts → ৳4,000
  ✓ Transfer 1: Commits, releases lock
  ✓ Transfer 2: Gets lock
  ✓ Transfer 2: Verifies ৳4,000 ≥ ৳7,000 ✗ FAILS
  ✓ RESULT: One succeeds, one fails (CORRECT)
  ✓ Final balance: ৳4,000 (consistent)

TECHNICAL EXPLANATION:
"Database row-level locking ensures only one transaction
can modify the same wallet at a time. We use SERIALIZABLE
isolation level - the strictest, most correct."

TIME: 60 seconds
```

### Scene 6: Network Failure & Recovery
```
Title: "Real-World: What if the network fails?"

ACTION:
- User A initiates transfer
- During processing, kill the network connection
- User sees "Transfer status uncertain"
- After network recovers, user checks status

SHOW:
- Instead of guessing, the system shows:
  "Transfer status uncertain (Transaction ID: TXN-ABC123)"
  [Check Status] button
  
- User clicks "Check Status"
- System queries database
- Definitive answer appears:
  "✓ Transfer completed successfully"
  or
  "✗ Transfer failed: [reason]"

NARRATIVE:
"Without proper design, users wouldn't know if their money was sent.
MoneyFlow maintains a ledger of every transaction. Even if the response
was lost, the money either arrived or didn't - and we can prove it."

TIME: 45 seconds
```

### Scene 7: Money Requests
```
Title: "Alternative: Money Requests"

ACTION:
- User B requests ৳1,200 from User A
- User B sees "Request PENDING"
- User A receives notification
- User A approves the request
- Transfer executes automatically

SHOW:
- Request workflow
- Notification system working
- Final transfer in both histories
- Request status = APPROVED

TIME: 30 seconds
```

### Demo Conclusion
```
Title: "Why This Matters"

SUMMARY:
"Building a money movement system isn't about moving money.
It's about TRUST.

✓ Atomicity: Transfers are all-or-nothing
✓ Correctness: Balances never go negative
✓ Idempotency: Double-clicks don't duplicate transfers
✓ Concurrency: Simultaneous requests are handled correctly
✓ Traceability: Every transaction has an ID and is auditable
✓ Resilience: Network failures don't cause data loss

The hackers who understand THESE problems will build financial systems
that scale to millions of users and never lose a single transaction."

FINAL DEMO:
- Show admin dashboard or query showing:
  * Total users: 2
  * Total transactions: 5
  * Total money in system: ৳200,000 (unchanged)
  * Ledger entries: 10 (perfect balance)

CLOSING:
"We built a small, polished, technically defensible money movement system
in 6 hours. Every design decision prioritizes correctness."
```

---

## 29. JUDGE-FACING DIFFERENTIATORS

### Technical Differentiators (Verifiable in Demo)

1. **Idempotent Transactions**
   - **How to demonstrate:** Double-click send button, show single transaction ID
   - **Judge sees:** Despite repeated request, money transferred only once
   - **Why it matters:** Production systems handle network retries

2. **Concurrency-Safe Balance Updates**
   - **How to demonstrate:** Run concurrent transfer stress test in demo
   - **Judge sees:** 50 simultaneous transfers don't cause overdraft
   - **Why it matters:** Real systems face simultaneous requests, esp. on payday

3. **Immutable Transaction History**
   - **How to demonstrate:** Click a transaction, show it cannot be modified
   - **Judge sees:** Ledger entries create permanent audit trail
   - **Why it matters:** Trust requires unchangeable records

4. **Atomic Money Movement**
   - **How to demonstrate:** Show database constraint preventing negative balance
   - **Judge sees:** Balance can NEVER be negative (even if software bugs)
   - **Why it matters:** Database constraints are ultimate safety net

5. **Transaction Traceability**
   - **How to demonstrate:** Show how any transfer can be looked up by ID
   - **Judge sees:** Unique transaction ID, ledger entries, timestamp
   - **Why it matters:** Support can investigate any issue ("where's my money?")

6. **Graceful Failure Handling**
   - **How to demonstrate:** Show error messages for all failure scenarios
   - **Judge sees:** "Insufficient balance" not "Error"
   - **Why it matters:** Users understand what happened

7. **Stateless Scalable Architecture**
   - **How to demonstrate:** Show code/deployment config with multiple instances
   - **Judge sees:** Can scale from 1 to 1000 app servers without code change
   - **Why it matters:** Horizontally scalable for growth

### Product Differentiators

1. **UI/UX Clarity**
   - Dashboard that shows balance clearly
   - Transaction history that makes sense
   - Confirmation screens that prevent accidents
   - Error messages that are actionable

2. **Bangladeshi Context**
   - Amounts in BDT (not generic currency)
   - UI suitable for bKash-like use cases
   - Supports money requests (common in South Asia)

3. **Architectural Thinking**
   - Chose right database (PostgreSQL, not MongoDB)
   - Used row-level locking (not optimistic concurrency)
   - SERIALIZABLE isolation (correct, not just fast)
   - Chose monolith (not premature microservices)

### NOT A Differentiator (Don't Claim)

- ✗ "Built in 6 hours" (everyone did)
- ✗ "Very fast" (correctness > speed for hackathon)
- ✗ "Has 50 features" (depth > breadth)
- ✗ "Microservices architecture" (overkill, not needed)
- ✗ "Real bank integration" (out of scope)
- ✗ "Fraud detection AI" (not demonstrated, probably unnecessary)

### What Makes This Submission Stand Out

**For Judges with banking/fintech background:**
"We prioritized correctness over feature count. We understand that
money movement is fundamentally a correctness problem. We implemented
SERIALIZABLE transaction isolation, row-level locking, idempotency keys,
immutable ledgers, and atomic operations. This is how real systems do it."

**For Judges with software engineering background:**
"We made deliberate architectural choices: monolith (not microservices),
PostgreSQL (not NoSQL), ACID (not eventually-consistent). We show that
thinking about concurrency, idempotency, and recovery is more important
than building 100 features."

**For Judges who will use bKash or similar apps:**
"We built something you could actually use. Money requests, clear
transaction IDs, transaction history you can trust. If something goes
wrong, you can prove what happened."

---

## 30. RISKS & MITIGATION

| Risk | Impact | Probability | Mitigation |
|------|--------|------------|-----------|
| **Race condition in concurrent transfers** | Overdraft, money duplication | MEDIUM | Use SERIALIZABLE isolation, row-level locking, database constraints |
| **Duplicate transfers via double-click** | Money sent twice | HIGH | Implement idempotency keys with unique constraint |
| **Network timeout uncertainty** | User doesn't know if transfer succeeded | HIGH | Implement status checking by transaction ID, polling |
| **Database connection pool exhaustion** | System becomes unresponsive | MEDIUM | Configure pool size, implement connection pooling |
| **Ledger mismatch** | Balances don't match ledger entries | LOW | Implement verification on startup, alerting |
| **Insufficient testing time** | Bugs discovered during demo | MEDIUM | Prioritize critical paths, write tests early |
| **Scope creep** | Running out of time | HIGH | Define MVP clearly, say "no" to new features |
| **Poor code quality** | Hard to debug, unmaintainable | MEDIUM | Code reviews, consistent style, clear naming |
| **UI/UX not ready** | Looks unfinished, demo is awkward | MEDIUM | Design UI early, iterate on mockups |
| **Database migration issues** | Data loss or corruption | LOW | Test migrations locally, have rollback plan |
| **Authentication vulnerabilities** | Accounts compromised | MEDIUM | Use bcrypt, HTTPS, rate limiting |
| **Notification service failure** | Users don't know about transfers | LOW | Make notifications async, non-blocking |
| **Backend crashes during demo** | Demo fails completely | MEDIUM | Test deployment, have backup environment ready |
| **Git merge conflicts** | Wasted time resolving conflicts | MEDIUM | Clear code ownership, frequent commits |
| **Dependency compatibility** | Libraries don't work together | MEDIUM | Test dependencies early, lock versions |
| **Performance degradation under load** | System slow during stress test | MEDIUM | Optimize indexes, test with realistic load |
| **Wrong architectural choices** | Architecture becomes bottleneck | LOW | Validate architecture early with prototype |

---

## 31. IMPLEMENTATION PLAN

### Pre-Hackathon (Prep: 1-2 hours before start)

- [ ] Repo initialized with skeleton code
- [ ] Docker Compose configured
- [ ] Database schema drafted
- [ ] API specs documented
- [ ] Team roles assigned:
  - Backend lead
  - Frontend lead
  - Database/DevOps
  - QA/Testing

### Phase 1: Foundation (Hackathon: 0:00 - 1:30)

**Backend:**
- [ ] Project setup (Express/Node.js)
- [ ] Database connection (PostgreSQL)
- [ ] User model + table
- [ ] Wallet model + table
- [ ] Authentication endpoints (register, login)
- [ ] JWT token generation/validation

**Frontend:**
- [ ] React/React Native setup
- [ ] Login page
- [ ] Registration page
- [ ] Dashboard skeleton
- [ ] API client setup

**Deliverable:** Users can register and log in

### Phase 2: Core Money Movement (Hackathon: 1:30 - 3:30)

**Backend:**
- [ ] Transfer model + table
- [ ] Transfer creation endpoint
- [ ] Database-level atomic transaction
- [ ] Row-level locking (SELECT FOR UPDATE)
- [ ] Balance verification + debit/credit
- [ ] Ledger entries (immutable log)
- [ ] Idempotency key implementation
- [ ] Error handling & validation
- [ ] Status tracking (PENDING → COMPLETED/FAILED)

**Frontend:**
- [ ] Send money screen
- [ ] Recipient search
- [ ] Confirmation screen
- [ ] Success/failure screens
- [ ] Transaction history display

**Testing:**
- [ ] Unit tests for transfer logic
- [ ] Integration test for full transfer API
- [ ] Concurrent transfer test

**Deliverable:** Users can send money, balances update correctly

### Phase 3: Money Requests & History (Hackathon: 3:30 - 4:30)

**Backend:**
- [ ] Money request model + table
- [ ] Request creation endpoint
- [ ] Approve/reject endpoints
- [ ] Transaction history query
- [ ] Filter/pagination support

**Frontend:**
- [ ] Money requests screen (received/sent)
- [ ] Request approval/rejection UI
- [ ] Transaction history with filtering
- [ ] Transaction details screen

**Testing:**
- [ ] Money request workflow test
- [ ] History query test

**Deliverable:** Complete money request workflow, searchable history

### Phase 4: Polish & Concurrency Testing (Hackathon: 4:30 - 5:15)

**Backend:**
- [ ] Concurrency stress test (50+ simultaneous transfers)
- [ ] Idempotency verification test
- [ ] Error scenario tests
- [ ] Logging & observability

**Frontend:**
- [ ] UI responsiveness
- [ ] Loading states
- [ ] Error message clarity
- [ ] Mobile responsiveness

**Deliverable:** System handles stress test without errors

### Phase 5: Demo Preparation (Hackathon: 5:15 - 6:00)

- [ ] Demo script finalized
- [ ] Demo data seeded
- [ ] Backup environment ready
- [ ] Demo flow practiced
- [ ] Edge cases tested
- [ ] Screenshots/video prepared
- [ ] Presentation slides (if required)

**Deliverable:** Ready for judging

---

### Prioritization (What if Time Runs Out)

**Must have:**
1. User registration ✓
2. Money transfer (working) ✓
3. Transaction history ✓
4. Idempotency protection ✓

**Nice to have:**
1. Money requests
2. Concurrent transfer testing
3. Admin viewing
4. Analytics

**Can drop if needed:**
1. Beautiful UI animations
2. Transaction PDF export
3. Advanced filtering
4. Email notifications

---

## 32. DEFINITION OF DONE

### Product Completeness

- [ ] User can register with email and password
- [ ] User receives initial ৳100,000 balance
- [ ] User can log in and log out
- [ ] User can send money to another user
- [ ] User can request money from another user
- [ ] User can approve or reject money requests
- [ ] User can view transaction history
- [ ] User can view transaction details
- [ ] User can search for other users
- [ ] Balance updates correctly after every transaction
- [ ] Notifications work (in-app minimum)
- [ ] UI works on mobile and desktop

### Engineering Correctness

- [ ] No race conditions (concurrent transfers tested)
- [ ] No duplicates (idempotency tested)
- [ ] No money loss/creation (ledger balanced)
- [ ] Atomic transfers (all-or-nothing)
- [ ] Database constraints prevent negative balance
- [ ] Transaction status is always known
- [ ] Idempotency keys prevent double-execution
- [ ] Database transactions use SERIALIZABLE isolation
- [ ] Row-level locking on wallet updates
- [ ] Ledger entries created for every transfer
- [ ] Transaction IDs are unique and permanent
- [ ] Error messages are clear and actionable

### Testing

- [ ] Unit tests cover critical logic (70%+ coverage)
- [ ] Integration tests for all APIs
- [ ] Concurrency test: 50 simultaneous transfers
- [ ] Idempotency test: retry same request twice
- [ ] Failure scenario tests: insufficient balance, user not found, etc.
- [ ] All tests passing
- [ ] No test warnings/failures

### Code Quality

- [ ] Code is readable (clear naming, comments where needed)
- [ ] No hard-coded secrets (use environment variables)
- [ ] Error handling is comprehensive
- [ ] Logging is structured and useful
- [ ] No security vulnerabilities (password hashing, HTTPS-ready)
- [ ] Database queries are optimized
- [ ] No SQL injection vulnerabilities

### Deployment & DevOps

- [ ] Local setup works via Docker Compose
- [ ] Database migrations run successfully
- [ ] Application starts without errors
- [ ] Health check endpoint works
- [ ] Environment variables documented
- [ ] Deployment instructions clear

### Documentation

- [ ] README with setup instructions
- [ ] API documentation or postman collection
- [ ] Database schema documentation
- [ ] Architecture diagram
- [ ] Demo script ready
- [ ] Presentation/slides (if required)

### Demo Readiness

- [ ] Demo scenario practiced
- [ ] Demo data seeded
- [ ] All demo features working
- [ ] Backup environment ready
- [ ] Edge cases tested
- [ ] No obvious bugs
- [ ] Demo takes < 5 minutes
- [ ] Judges understand the value prop

---

# APPENDIX: CRITICAL DECISIONS SUMMARY

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Monolith (not microservices) | Simplicity, speed, correctness, easier to maintain ACID |
| Database | PostgreSQL | ACID, row-level locking, SERIALIZABLE isolation |
| Isolation Level | SERIALIZABLE | Prevents all race conditions by design |
| Concurrency Control | Pessimistic (row-level locks) | Safe by design, prevents race conditions |
| Money Representation | Integer paisa (not floating-point) | Prevents precision loss, financial correctness |
| Transfer Model | Wallet balance + Immutable ledger | Fast queries + full auditability |
| Transaction Status | Explicit state machine | Clear status for user, error recovery possible |
| Idempotency | Keys with unique constraint | Simple, reliable, database-enforced |
| Notifications | Async, fire-and-forget | Non-blocking, correctness doesn't depend on notifications |
| Scalability | Horizontal (stateless instances) | Easy to scale, no single point of failure |
| Authentication | Stateless JWT | Scales easily, no session storage needed |
| API Pattern | REST | Standard, simple, well-understood |

---

# FINAL NOTES

This PRD is designed to be **implementation-ready** for a hackathon team. Every major decision has been made, every technical concern addressed, and every edge case considered.

**The goal:** A technically excellent, correctness-focused money movement system that judges will recognize as **serious engineering thinking**.

**Not a goal:** Building every possible feature or claiming to be a full banking platform.

**The challenge understood:** Moving money correctly is hard. This PRD solves that problem.

---

**PRD Version:** 1.0  
**Date:** 29 August 2026  
**Status:** Ready for Implementation  
**Hackathon Duration:** 9:00 AM - 3:00 PM (6 hours)  

**Good luck! 🚀**
