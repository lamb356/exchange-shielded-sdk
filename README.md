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

// Process a withdrawal
const result = await sdk.processWithdrawal({
  userId: 'user-123',
  fromAddress: 'zs1sourceaddress...',
  toAddress: 'zs1destinationaddress...',
  amount: 10.5
});

if (result.success) {
  console.log('Transaction ID:', result.transactionId);
} else {
  console.error('Failed:', result.error);
}
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

## Production Warnings

> **Important**: Review these items before deploying to production.

### Rate Limits are In-Memory Only

Rate limits are stored in-memory and will be lost on restart. For production deployments with multiple instances or high availability requirements:

```typescript
// TODO: Implement Redis backing for rate limits
// The WithdrawalRateLimiter class is designed for single-instance use.
// For production, implement a custom rate limiter backed by Redis or similar.
```

### getWithdrawalStatus() is a Stub

The `getWithdrawalStatus()` method currently returns a basic status. For production, implement proper confirmation tracking:

```typescript
// Current behavior: returns { status: 'unknown', ... }
// Production: Implement transaction confirmation tracking via z_gettransaction
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
    tls: process.env.NODE_ENV === 'production', // Enable TLS in production
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
