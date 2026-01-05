# Exchange Shielded SDK

A TypeScript SDK for cryptocurrency exchanges to process Zcash shielded withdrawals securely and compliantly.

## Features

- **Address Validation**: Full support for transparent (t1/t3), Sapling (zs), and Unified (u1) addresses
- **Shielded Transactions**: Build and submit shielded withdrawals with ZIP 317 fee estimation
- **RPC Client**: Type-safe JSON-RPC client for zcashd/zebrad communication
- **Security**: AES-256-GCM key encryption, input sanitization, and secure key handling
- **Rate Limiting**: Configurable sliding window rate limits per user
- **Audit Logging**: Tamper-evident hash chain audit logs for compliance
- **Compliance**: Velocity checks, suspicious activity detection, and viewing key export

## Installation

```bash
npm install exchange-shielded-sdk
```

## Quick Start

### Basic Withdrawal

```typescript
import { createExchangeSDK } from 'exchange-shielded-sdk';

// Initialize the SDK
const sdk = createExchangeSDK({
  rpc: {
    host: '127.0.0.1',
    port: 8232,
    auth: { username: 'rpcuser', password: 'rpcpassword' }
  },
  enableCompliance: true,
  enableAuditLogging: true
});

// Process a withdrawal (amounts in zatoshis: 10.5 ZEC = 1_050_000_000n)
const result = await sdk.processWithdrawal({
  userId: 'user-123',
  fromAddress: 'zs1sourceaddress...',
  toAddress: 'zs1destinationaddress...',
  amount: 1_050_000_000n  // 10.5 ZEC in zatoshis
});

if (result.success) {
  console.log('Transaction ID:', result.transactionId);
} else {
  console.error('Failed:', result.error);
}
```

### Recommended: Use DTO Methods (JSON-Safe)

For external integrations, use the DTO boundary methods which accept and return string amounts:

```typescript
import { createExchangeSDK, WithdrawalRequestDTO } from 'exchange-shielded-sdk';

const sdk = createExchangeSDK({ /* config */ });

// All amounts are strings - safe for JSON serialization
const request: WithdrawalRequestDTO = {
  userId: 'user-123',
  fromAddress: 'zs1sourceaddress...',
  toAddress: 't1destinationaddress...',
  amount: '150000000',  // 1.5 ZEC in zatoshis (string)
};

const result = await sdk.processWithdrawalDTO(request);
console.log(result.amount);  // "150000000" (string, JSON-safe)

// Other DTO methods available:
// sdk.getWithdrawalStatusDTO(requestId)
// sdk.listPendingWithdrawalsDTO()
// sdk.getWithdrawalByTxidDTO(txid)
// sdk.refreshWithdrawalStatusDTO(requestId)
```

### Address Validation

```typescript
import { validateAddress, isShielded, validateAddressDetailed } from 'exchange-shielded-sdk';

// Quick validation
const type = validateAddress('zs1abc...');  // Returns: 'sapling'
const shielded = isShielded('zs1abc...');   // Returns: true

// Detailed validation
const details = validateAddressDetailed('t1abc...');
// Returns: { valid: true, type: 'transparent', shielded: false, network: 'mainnet' }
```

### Fee Estimation

```typescript
import { estimateTransactionFee, ZIP317 } from 'exchange-shielded-sdk';

const fee = estimateTransactionFee({
  saplingSpends: 1,
  saplingOutputs: 2,
  transparentOutputs: 1
});

console.log(`Fee: ${fee.zec} ZEC (${fee.zatoshis} zatoshis)`);
console.log(`Logical actions: ${fee.logicalActions}`);
```

## API Reference

### Address Validation

| Function | Description |
|----------|-------------|
| `validateAddress(address)` | Returns address type: `'transparent'`, `'sapling'`, `'unified'`, or `'unknown'` |
| `isShielded(address)` | Returns `true` if address is shielded (zs, u1) |
| `validateAddressDetailed(address)` | Returns detailed validation result with type, network, and shielded status |
| `parseUnifiedAddress(ua)` | Parses unified address components (orchard, sapling, transparent) |
| `getAddressPrefixes(type, network)` | Returns valid prefixes for address type and network |

### Transaction Builder

| Class/Function | Description |
|----------------|-------------|
| `ShieldedTransactionBuilder` | Builds shielded withdrawal transactions |
| `estimateTransactionFee(options)` | Estimates ZIP 317 compliant fee |
| `calculateLogicalActions(options)` | Calculates logical actions for fee |
| `ZIP317` | Fee calculation constants |

### RPC Client

| Class/Function | Description |
|----------------|-------------|
| `ZcashRpcClient` | JSON-RPC client for zcashd |
| `createRpcClient(host, port, auth)` | Factory function for RpcClient |

**Key Methods:**
- `z_sendmany()` - Send shielded transactions
- `z_getbalance()` - Get address balance
- `z_listunspent()` - List unspent notes
- `waitForOperation()` - Wait for async operation completion

### Security

| Class/Function | Description |
|----------------|-------------|
| `SecureKeyManager` | AES-256-GCM encrypted key storage |
| `WithdrawalRateLimiter` | Sliding window rate limiting |
| `sanitizeAddress()` | Validate and sanitize address input |
| `sanitizeAmount()` | Validate and sanitize amount input |
| `redactSensitiveData()` | Redact sensitive fields for logging |

### Compliance

| Class/Function | Description |
|----------------|-------------|
| `AuditLogger` | Tamper-evident audit logging |
| `ComplianceManager` | Velocity checks and compliance reporting |
| `AuditEventType` | Enum of audit event types |
| `AuditSeverity` | Enum of severity levels |

### High-Level SDK

| Class/Function | Description |
|----------------|-------------|
| `ExchangeShieldedSDK` | Unified SDK combining all features |
| `createExchangeSDK(config)` | Factory function for SDK |

## Configuration Options

### SDK Configuration

```typescript
interface SDKConfig {
  rpc: {
    host: string;           // zcashd host (default: '127.0.0.1')
    port: number;           // zcashd port (default: 8232)
    auth: {
      username: string;
      password: string;
    };
    timeout?: number;       // Request timeout in ms (default: 30000)
    https?: boolean;        // Use HTTPS (default: false)
  };
  keyManager?: {
    maxKeys?: number;           // Max keys in memory (default: 100)
    autoClearAfterMs?: number;  // Auto-clear inactive keys (default: 0 = disabled)
  };
  rateLimiter?: {
    maxWithdrawalsPerHour?: number;    // Default: 10
    maxWithdrawalsPerDay?: number;     // Default: 50
    maxAmountPerWithdrawal?: number;   // Default: 100 ZEC
    maxTotalAmountPerDay?: number;     // Default: 1000 ZEC
    cooldownMs?: number;               // Default: 60000 (1 min)
  };
  enableCompliance?: boolean;    // Enable compliance features (default: true)
  enableAuditLogging?: boolean;  // Enable audit logging (default: true)
  minconf?: number;              // Minimum confirmations (default: 10)
  privacyPolicy?: string;        // Privacy policy (default: 'FullPrivacy')
}
```

## Security Features

### Key Management

- **AES-256-GCM Encryption**: Keys are encrypted at rest using AES-256-GCM with scrypt key derivation
- **Memory Protection**: Keys are securely zeroed when cleared
- **No Key Logging**: Keys never appear in logs, errors, or stack traces
- **Auto-Clear**: Optional automatic clearing of inactive keys

### Input Sanitization

- All user inputs are validated and sanitized before processing
- Addresses are validated for correct format and type
- Amounts are validated for reasonable bounds
- Memos are validated for hex encoding and length limits

### Rate Limiting

- Per-user sliding window rate limits
- Configurable limits for withdrawals per hour/day
- Maximum amount per withdrawal and per day
- Cooldown period between withdrawals

## Compliance Features

### Audit Logging

- Tamper-evident hash chain linking all events
- Automatic redaction of sensitive data
- Configurable severity levels
- Export for compliance review

### Velocity Checks

- Detect unusual withdrawal patterns
- Risk scoring for each transaction
- Automatic flagging of suspicious activity

### Viewing Key Export

- Export viewing keys for auditors
- Bundle multiple keys with integrity hash
- Configurable validity periods

## Address Types

| Type | Prefix | Encoding | Description |
|------|--------|----------|-------------|
| Transparent (P2PKH) | `t1` | Base58Check | Pay-to-Public-Key-Hash (mainnet) |
| Transparent (P2SH) | `t3` | Base58Check | Pay-to-Script-Hash (mainnet) |
| Transparent (testnet) | `tm`, `t2` | Base58Check | Testnet transparent addresses |
| Sprout | `zc`, `zt` | Base58Check | Legacy shielded (deprecated) |
| Sapling | `zs` | Bech32 | Current shielded address format |
| Sapling (testnet) | `ztestsapling` | Bech32 | Testnet Sapling addresses |
| Unified | `u1` | Bech32m | Multi-receiver address (NU5+) |
| Unified (testnet) | `utest` | Bech32m | Testnet unified addresses |

## Amount Handling

All amounts in this SDK should use **zatoshis (bigint)** to prevent floating-point rounding errors:

```typescript
import { zecToZatoshis, zatoshisToZec, validateZatoshis } from 'exchange-shielded-sdk';

// Convert ZEC to zatoshis (1 ZEC = 100,000,000 zatoshis)
const zatoshis = zecToZatoshis(1.5);  // Returns: 150000000n

// Convert back for display
const zec = zatoshisToZec(150000000n);  // Returns: 1.5

// Validate amounts
validateZatoshis(amount);  // Throws if negative or exceeds 21M ZEC
```

## Money & Units

This SDK uses **zatoshis** (the smallest Zcash unit) internally to prevent floating-point errors.

### Type System

| Type | Description | Example |
|------|-------------|---------|
| `Zatoshi` | Branded bigint for compile-time safety | `zatoshi(150_000_000n)` |
| `ZatoshiString` | String representation for JSON | `"150000000"` |

### Conversion

- 1 ZEC = 100,000,000 zatoshis
- Use `zecToZatoshi(1.5)` -> `150000000n`
- Use `zatoshiToZec(zatoshi(150000000n))` -> `1.5`

### Where Conversions Happen

| Location | Format | Why |
|----------|--------|-----|
| Public API | `Zatoshi` (bigint) | Type safety, no rounding |
| Internal logic | `Zatoshi` (bigint) | Exact math |
| Storage/JSON | `ZatoshiString` | JSON.stringify safe |
| RPC boundary | `"1.50000000"` | zcashd expects string |

### Example

```typescript
import { zatoshi, zecToZatoshi, createExchangeSDK } from 'exchange-shielded-sdk';

const sdk = createExchangeSDK({ /* config */ });

// Type-safe amount creation
const amount = zatoshi(150_000_000n);  // 1.5 ZEC

// OR convert from ZEC
const amount2 = zecToZatoshi(1.5);     // Also 1.5 ZEC

// SDK requires Zatoshi type
const result = await sdk.processWithdrawal({
  userId: 'user-123',
  fromAddress: 'zs1...',
  toAddress: 'zs1...',
  amount: zatoshi(150_000_000n),  // Type-safe
});
```

### JSON Serialization

```typescript
import { safeJsonStringify, safeJsonParse } from 'exchange-shielded-sdk';

// Serialize (bigint -> string)
const json = safeJsonStringify({ amount: zatoshi(100n) });
// -> '{"amount":"100"}'

// Parse (string -> bigint)
const obj = safeJsonParse(json, ['amount']);
// -> { amount: 100n }
```

## Production Deployment

> **WARNING**: The SDK ships with in-memory storage implementations that are NOT suitable for production use. Production deployments MUST provide persistent storage adapters.

### Storage Adapter Pattern

The SDK uses pluggable storage adapters for production scalability:

```typescript
import {
  createExchangeSDK,
  IdempotencyStore,
  WithdrawalStatusStore,
} from 'exchange-shielded-sdk';

// Example Redis implementation
class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private redis: RedisClient) {}

  async get(requestId: string) {
    const data = await this.redis.get(`idempotency:${requestId}`);
    if (!data) return null;
    return JSON.parse(data, (key, value) => {
      if (key === 'fee') return BigInt(value);
      if (key === 'completedAt') return new Date(value);
      return value;
    });
  }

  async set(requestId: string, result: WithdrawalResult, ttlMs?: number) {
    const serialized = JSON.stringify(result, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    if (ttlMs) {
      await this.redis.setex(`idempotency:${requestId}`, ttlMs / 1000, serialized);
    } else {
      await this.redis.set(`idempotency:${requestId}`, serialized);
    }
  }

  async has(requestId: string) {
    return (await this.redis.exists(`idempotency:${requestId}`)) === 1;
  }

  async delete(requestId: string) {
    return (await this.redis.del(`idempotency:${requestId}`)) === 1;
  }
}

// Use custom storage in SDK
const sdk = createExchangeSDK({
  rpc: { /* ... */ },
  idempotencyStore: new RedisIdempotencyStore(redisClient),
  withdrawalStatusStore: new RedisWithdrawalStatusStore(redisClient),
});
```

### PostgreSQL Audit Sink Example

For compliance requirements, implement a persistent audit log:

```typescript
import { AuditLogSink, AuditEvent, AuditFilter } from 'exchange-shielded-sdk';

class PostgresAuditLogSink implements AuditLogSink {
  constructor(private pool: Pool) {}

  async append(event: AuditEvent) {
    await this.pool.query(
      `INSERT INTO audit_events (id, timestamp, event_type, severity, user_id,
       transaction_id, amount, destination_address, metadata, previous_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [event.id, event.timestamp, event.eventType, event.severity, event.userId,
       event.transactionId, event.amount, event.destinationAddress,
       JSON.stringify(event.metadata), event.previousHash, event.hash]
    );
  }

  async query(filter: AuditFilter) {
    // Build SQL from filter criteria
    let sql = 'SELECT * FROM audit_events WHERE 1=1';
    const params: any[] = [];
    // ... add filter conditions
    const { rows } = await this.pool.query(sql, params);
    return rows.map(this.rowToEvent);
  }

  async getLastHash() {
    const { rows } = await this.pool.query(
      'SELECT hash FROM audit_events ORDER BY timestamp DESC LIMIT 1'
    );
    return rows[0]?.hash ?? '0'.repeat(64);
  }

  async count() {
    const { rows } = await this.pool.query('SELECT COUNT(*) FROM audit_events');
    return parseInt(rows[0].count, 10);
  }
}
```

### Horizontal Scaling

For high availability and horizontal scaling:

1. **Stateless Workers**: SDK instances are stateless when using external storage
2. **Shared Storage**: All workers connect to same Redis/PostgreSQL
3. **Idempotency**: Request IDs prevent double-withdrawals across workers

```
                 +-------------+
                 |   Load      |
                 |  Balancer   |
                 +------+------+
                        |
         +--------------+--------------+
         |              |              |
   +-----v----+   +-----v----+   +-----v----+
   | Worker 1 |   | Worker 2 |   | Worker 3 |
   | (SDK)    |   | (SDK)    |   | (SDK)    |
   +-----+----+   +-----+----+   +-----+----+
         |              |              |
         +--------------+--------------+
                        |
              +---------+---------+
              |                   |
        +-----v-----+       +-----v-----+
        |   Redis   |       | PostgreSQL|
        | (cache)   |       | (audit)   |
        +-----------+       +-----------+
```

### RPC Security

- **Always use TLS** for RPC connections to non-localhost nodes
- **Never log credentials** - the SDK redacts sensitive data but ensure your logging doesn't expose auth
- Use environment variables or secure vaults for RPC credentials

```typescript
// Good: Load credentials from environment
const sdk = createExchangeSDK({
  rpc: {
    host: process.env.ZCASH_RPC_HOST!,
    port: parseInt(process.env.ZCASH_RPC_PORT!),
    auth: {
      username: process.env.ZCASH_RPC_USER!,
      password: process.env.ZCASH_RPC_PASS!,
    },
    https: process.env.NODE_ENV === 'production',
  },
});
```

## Requirements

- Node.js 18.0.0 or higher
- Running zcashd or zebrad instance
- TypeScript 5.0+ (for development)

## Documentation

- [Full API Reference](./docs/API.md)
- [Integration Guide](./docs/INTEGRATION-GUIDE.md)
- [Security Best Practices](./docs/SECURITY-BEST-PRACTICES.md)

## Examples

See the [examples](./examples) directory for complete working examples:

- [Basic Withdrawal](./examples/basic-withdrawal.ts)
- [Compliance Setup](./examples/compliance-setup.ts)
- [Rate Limiting](./examples/rate-limiting.ts)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## Security

See [SECURITY.md](./SECURITY.md) for security policy and vulnerability reporting.

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.
