# Exchange Shielded SDK Architecture

This document describes the architectural decisions and design patterns used in the Exchange Shielded SDK.

## Overview

The SDK is designed for cryptocurrency exchanges to process Zcash shielded withdrawals with:

- **Security**: Preventing double-withdrawals, key protection, input sanitization
- **Compliance**: Audit logging, velocity checks, viewing key export
- **Scalability**: Pluggable storage for horizontal scaling
- **Correctness**: Zatoshis-first amounts to prevent floating-point errors

## Core Design Principles

### 1. Zatoshis-First (bigint Amounts)

**Why**: Floating-point arithmetic causes rounding errors that can lead to incorrect transaction amounts, fund loss, or security vulnerabilities.

**Implementation**: All monetary amounts in the public API use `bigint` (zatoshis):

```typescript
// 1 ZEC = 100_000_000 zatoshis (10^8)
const ZATOSHIS_PER_ZEC = 100_000_000n;

// Public API uses zatoshis
await sdk.processWithdrawal({
  userId: 'user-123',
  amount: 1_050_000_000n,  // 10.5 ZEC
});

// Conversion utilities available
import { zecToZatoshis, zatoshisToZec } from 'exchange-shielded-sdk';
const zatoshis = zecToZatoshis(10.5);  // 1_050_000_000n
const zec = zatoshisToZec(1_050_000_000n);  // 10.5
```

**Benefits**:
- No rounding errors in arithmetic
- Exact representation of all valid Zcash amounts
- Matches blockchain representation (satoshi-equivalent)
- Type safety prevents mixing ZEC and zatoshi values

## Money Types

### Why Branded Types?

TypeScript's bigint is great for precision, but doesn't prevent mixing units:

```typescript
// Without branded types - easy to make mistakes
const zatoshis: bigint = 100_000_000n;  // 1 ZEC
const zec: bigint = 1n;                  // Also 1 ZEC?
const total = zatoshis + zec;            // Bug! Mixed units
```

With branded types:
```typescript
const zatoshis: Zatoshi = zatoshi(100_000_000n);
const zec: bigint = 1n;
const total = zatoshis + zec;  // Type error! Can't add Zatoshi + bigint
```

### JSON Serialization Strategy

JavaScript's `JSON.stringify()` throws on bigint. Our strategy:

1. **Storage adapters**: Use `safeJsonStringify()` which converts bigint -> string
2. **Parsing**: Use `safeJsonParse(json, ['amount', 'fee'])` to convert string -> bigint
3. **RPC boundary**: Convert to ZEC string with 8 decimals: `(Number(z) / 1e8).toFixed(8)`

### Single Conversion Point

All numeric conversions happen at the RPC boundary in `prepareZSendmany()`:

```
User Input -> Zatoshi -> Internal Logic -> Zatoshi -> prepareZSendmany() -> "1.50000000" -> zcashd
```

This ensures:
- No floating-point math anywhere in business logic
- Single place to audit for conversion errors
- Type system enforces correct usage

## DTO Boundary Guidelines

The SDK enforces a clear separation between internal types (using branded `Zatoshi` bigints) and external DTOs (using string amounts for JSON safety).

### Type Boundaries

```
External World (JSON)          SDK Internal               zcashd (JSON-RPC)
+------------------+          +------------------+       +------------------+
| WithdrawalReq-   |  ingest  | WithdrawalRequest|       | z_sendmany       |
| uestDTO          | -------> | (bigint amounts) | ----> | (ZEC strings)    |
| (string amounts) |          |                  |       |                  |
+------------------+          +------------------+       +------------------+

+------------------+  egress  +------------------+
| WithdrawalRes-   | <------- | WithdrawalResult |
| ultDTO           |          | (bigint amounts) |
| (string amounts) |          |                  |
+------------------+          +------------------+
```

### Validation at Ingest

External inputs are validated and converted at the system boundary:

```typescript
import {
  fromWithdrawalRequestDTO,
  parseZatoshiInput,
  validateAddressInput,
  validateUserIdInput,
  IngestValidationError,
} from 'exchange-shielded-sdk';

// Convert DTO to internal types (validates automatically)
const dto: WithdrawalRequestDTO = req.body;
const request = fromWithdrawalRequestDTO(dto);

// Or validate individual fields
try {
  const amount = parseZatoshiInput(req.body.amount, 'amount');
  const address = validateAddressInput(req.body.address, 'toAddress');
  const userId = validateUserIdInput(req.body.userId);
} catch (e) {
  if (e instanceof IngestValidationError) {
    console.log(`Invalid ${e.field}: ${e.message}`);
  }
}
```

### Serialization at Egress

Internal results are converted to DTOs for API responses:

```typescript
import { toWithdrawalResultDTO, toWithdrawalStatusDTO } from 'exchange-shielded-sdk';

// Process withdrawal (internal types)
const result = await sdk.processWithdrawal(request);

// Convert to DTO for API response
const dto = toWithdrawalResultDTO(result);
res.json(dto);  // Amounts are strings, safe for JSON
```

### DTO Types

| DTO Type | Purpose | Amount Type |
|----------|---------|-------------|
| `WithdrawalRequestDTO` | API request body | `string` (zatoshis) |
| `WithdrawalResultDTO` | API response body | `string` (zatoshis) |
| `WithdrawalStatusDTO` | Status response | N/A |

### Why Strings for External DTOs?

1. **JSON Safety**: `JSON.stringify(1n)` throws; strings serialize safely
2. **Precision**: No precision loss for large amounts (Number.MAX_SAFE_INTEGER is 9007199254740991)
3. **Cross-language**: Strings work with any language's JSON parser
4. **Explicit**: Clear that parsing/validation is needed

### Input Validation Functions

| Function | Input Types | Returns | Throws |
|----------|-------------|---------|--------|
| `parseZatoshiInput()` | string, bigint, number | `Zatoshi` | `IngestValidationError` |
| `validateAddressInput()` | any | trimmed string | `IngestValidationError` |
| `validateUserIdInput()` | any | trimmed string | `IngestValidationError` |

### 2. Storage Adapter Pattern

**Why**: Production deployments need persistent, distributed storage. Development/testing needs simple, fast storage.

**Implementation**: Interfaces define storage contracts; implementations are pluggable:

```
src/storage/
  interfaces.ts    # IdempotencyStore, RateLimitStore, etc.
  memory.ts        # In-memory implementations
  index.ts         # Public exports
```

**Storage Interfaces**:

| Interface | Purpose | Production Backend |
|-----------|---------|-------------------|
| `IdempotencyStore` | Prevent double-withdrawals | Redis with TTL |
| `RateLimitStore` | User rate limit state | Redis with atomic ops |
| `AuditLogSink` | Compliance audit trail | PostgreSQL (WORM) |
| `WithdrawalStatusStore` | Track withdrawal lifecycle | Redis + PostgreSQL |

**Injection Pattern**:

```typescript
// SDK accepts custom storage via config
const sdk = createExchangeSDK({
  rpc: { /* ... */ },
  idempotencyStore: new RedisIdempotencyStore(redis),
  withdrawalStatusStore: new RedisWithdrawalStatusStore(redis),
});

// Falls back to in-memory if not provided (for dev/test only)
```

### 3. Withdrawal Lifecycle

Withdrawals progress through a defined state machine:

```
  pending ─────> submitted ─────> mempool ─────> confirmed
     │              │                │
     │              │                │
     └──────────────┴────────────────┴───────> failed
```

**States**:

| Status | Description |
|--------|-------------|
| `pending` | Request received, validation passed |
| `submitted` | Transaction sent to zcashd |
| `mempool` | Transaction in mempool, 0 confirmations |
| `confirmed` | Transaction mined with 1+ confirmations |
| `failed` | Transaction failed at any stage |

**Lifecycle Methods**:

```typescript
// Get current status
const status = await sdk.getWithdrawalStatus(requestId);

// Refresh from blockchain (queries confirmations)
const updated = await sdk.refreshWithdrawalStatus(requestId);

// List all non-confirmed
const pending = await sdk.listPendingWithdrawals();

// Lookup by txid
const byTx = await sdk.getWithdrawalByTxid(txid);
```

### 4. Idempotency

**Why**: Network failures can cause clients to retry requests. Without idempotency, retries could cause double-withdrawals.

**Implementation**: Request IDs uniquely identify withdrawal requests:

```typescript
// First request
const result1 = await sdk.processWithdrawal({
  requestId: 'req-abc123',  // Client-provided
  userId: 'user-1',
  amount: 1_000_000_000n,
  // ...
});

// Retry with same requestId returns cached result (no double-withdrawal)
const result2 = await sdk.processWithdrawal({
  requestId: 'req-abc123',  // Same ID
  // ...
});

assert(result1.transactionId === result2.transactionId);
```

**Cache Strategy**:
- Successful withdrawals: Cached indefinitely (or with long TTL)
- Failed withdrawals after attempt: Cached to prevent immediate retry
- Validation failures: NOT cached (allows retry with corrected input)

### 5. Tamper-Evident Audit Logging

**Why**: Compliance requires provable, unmodified audit trails.

**Implementation**: Hash chain links events:

```
Event N-1                Event N                 Event N+1
+-----------+           +-----------+           +-----------+
| id        |           | id        |           | id        |
| timestamp |           | timestamp |           | timestamp |
| data      |           | data      |           | data      |
| prevHash ─┼───────────┼→ hash    ─┼───────────┼→ ...      |
+-----------+           +-----------+           +-----------+
```

Each event includes:
- SHA-256 hash of previous event
- Own hash covering all fields
- Tampering breaks the chain (detectable)

**Automatic Redaction**:
```typescript
// Shielded addresses are partially redacted in logs
"zs1abc...xyz" → "zs1abc...xyz" (shows prefix + suffix)

// Sensitive metadata is redacted
{ privateKey: "..." } → { privateKey: "[REDACTED]" }
```

## Module Structure

```
src/
  index.ts                 # Main entry point, exports
  address-validator.ts     # Address validation (t1, zs, u1)
  transaction-builder.ts   # Shielded tx construction
  rpc-client.ts           # zcashd JSON-RPC client

  sdk/
    exchange-sdk.ts       # High-level SDK
    index.ts

  security/
    key-manager.ts        # AES-256-GCM key storage
    rate-limiter.ts       # Sliding window limits
    sanitizer.ts          # Input validation
    index.ts

  compliance/
    audit-logger.ts       # Tamper-evident logging
    compliance.ts         # Velocity checks, reporting
    index.ts

  storage/
    interfaces.ts         # Storage adapter interfaces
    memory.ts             # In-memory implementations
    index.ts

  utils/
    amounts.ts            # zatoshi/ZEC conversions
    logger.ts             # Structured logging
    index.ts

tests/
  unit/                   # Unit tests per module
  integration/            # SDK integration tests
  concurrency/           # Race condition tests
```

## Error Handling

Errors are categorized by error codes for programmatic handling:

| Code | Meaning |
|------|---------|
| `INVALID_FROM_ADDRESS` | Source address validation failed |
| `FROM_ADDRESS_NOT_SHIELDED` | Source must be shielded (zs/u1) |
| `INVALID_TO_ADDRESS` | Destination address validation failed |
| `INVALID_AMOUNT` | Amount <= 0 or exceeds max |
| `INVALID_MEMO` | Memo encoding/length invalid |
| `RATE_LIMITED` | User exceeded rate limits |
| `VELOCITY_CHECK_FAILED` | Suspicious activity detected |
| `TX_FAILED` | Transaction submission failed |
| `INTERNAL_ERROR` | Unexpected error |

## Performance Considerations

### Concurrency

The SDK is designed for concurrent use:

- Idempotency store prevents concurrent double-withdrawals
- Rate limiter uses atomic operations (when backed by Redis)
- Audit logger maintains order under concurrent writes

### Memory

In-memory storage limits:

```typescript
// Audit log caps at 100,000 events by default
const auditSink = new MemoryAuditLogSink(100000);

// Rate limit data grows with active users
// ~200 bytes per user with activity
```

### Network

RPC calls are the bottleneck:

- `z_sendmany`: 1-5 seconds (transaction building)
- `waitForOperation`: polls every 1 second
- Use connection pooling for high throughput

## Security Model

### Trust Boundaries

```
+------------------+    +------------------+    +------------------+
|   Untrusted      |    |   SDK (trusted)  |    |   zcashd         |
|   User Input     |───>|   - Validation   |───>|   (trusted)      |
|                  |    |   - Sanitization |    |                  |
+------------------+    +------------------+    +------------------+
```

### Key Protection

- Spending keys encrypted with AES-256-GCM
- Keys never logged or serialized
- Memory zeroed on clear
- Optional auto-clear after timeout

### Input Validation

All inputs validated before processing:

1. Addresses: Format, type, network
2. Amounts: Positive, within bounds
3. Memos: Hex encoding, length limits
4. User IDs: Alphanumeric, length limits

## Testing Strategy

| Test Type | Coverage | Purpose |
|-----------|----------|---------|
| Unit | Per function | Logic correctness |
| Integration | SDK flows | Component interaction |
| Concurrency | Race conditions | Thread safety |
| Property | Amount handling | Edge cases |

Run all tests:
```bash
npm test
npm run test:coverage
```

## Versioning

Follows [Semantic Versioning](https://semver.org/):

- **Major**: Breaking API changes
- **Minor**: New features, backward compatible
- **Patch**: Bug fixes

Breaking changes to storage interfaces require major version bump.
