# API Reference

Complete API documentation for the Exchange Shielded SDK.

## Table of Contents

- [Address Validator](#address-validator)
- [ShieldedTransactionBuilder](#shieldedtransactionbuilder)
- [ZcashRpcClient](#zcashrpcclient)
- [SecureKeyManager](#securekeymanager)
- [WithdrawalRateLimiter](#withdrawalratelimiter)
- [AuditLogger](#auditlogger)
- [ComplianceManager](#compliancemanager)
- [ExchangeShieldedSDK](#exchangeshieldedsdk)
- [Types and Interfaces](#types-and-interfaces)

---

## Address Validator

Functions for validating Zcash addresses across all supported formats.

### validateAddress

Detects the type of a Zcash address based on its prefix and format.

```typescript
function validateAddress(address: string): AddressType
```

**Parameters:**
- `address` - The address string to validate

**Returns:** `AddressType` - One of `'transparent'`, `'sprout'`, `'sapling'`, `'orchard'`, `'unified'`, or `'unknown'`

**Example:**
```typescript
import { validateAddress } from 'exchange-shielded-sdk';

validateAddress('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU');  // 'transparent'
validateAddress('zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly');  // 'sapling'
validateAddress('u1qw508d6qejxtdg4y5r3zarvary0c5xw7...');  // 'unified'
validateAddress('invalid');  // 'unknown'
```

### isShielded

Determines if an address is shielded (privacy-preserving).

```typescript
function isShielded(address: string): boolean
```

**Parameters:**
- `address` - The address string to check

**Returns:** `boolean` - `true` if the address is shielded (sprout, sapling, orchard, or unified)

**Example:**
```typescript
import { isShielded } from 'exchange-shielded-sdk';

isShielded('t1abc...');   // false (transparent)
isShielded('zs1abc...');  // true (sapling)
isShielded('u1abc...');   // true (unified)
```

### parseUnifiedAddress

Parses a Unified Address to detect its component receivers.

```typescript
function parseUnifiedAddress(ua: string): UnifiedAddressComponents
```

**Parameters:**
- `ua` - The Unified Address string to parse

**Returns:** `UnifiedAddressComponents` - Object indicating which receiver types are present

**Example:**
```typescript
import { parseUnifiedAddress } from 'exchange-shielded-sdk';

const components = parseUnifiedAddress('u1abc...');
// { orchard: true, sapling: undefined, transparent: undefined }
```

### validateAddressDetailed

Performs comprehensive address validation with detailed results.

```typescript
function validateAddressDetailed(address: string): AddressValidationResult
```

**Parameters:**
- `address` - The address string to validate

**Returns:** `AddressValidationResult` - Detailed validation result

**Example:**
```typescript
import { validateAddressDetailed } from 'exchange-shielded-sdk';

const result = validateAddressDetailed('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU');
// {
//   valid: true,
//   type: 'transparent',
//   shielded: false,
//   network: 'mainnet'
// }

const invalid = validateAddressDetailed('invalid');
// {
//   valid: false,
//   type: 'unknown',
//   shielded: false,
//   network: 'unknown',
//   error: 'Unrecognized address format'
// }
```

### getAddressPrefixes

Gets the network prefix requirements for a given address type and network.

```typescript
function getAddressPrefixes(
  type: Exclude<AddressType, 'unknown' | 'orchard'>,
  network?: 'mainnet' | 'testnet'
): string[]
```

**Parameters:**
- `type` - The address type
- `network` - The target network (default: `'mainnet'`)

**Returns:** `string[]` - Array of valid prefixes

**Example:**
```typescript
import { getAddressPrefixes } from 'exchange-shielded-sdk';

getAddressPrefixes('transparent', 'mainnet');  // ['t1', 't3']
getAddressPrefixes('sapling', 'testnet');      // ['ztestsapling']
getAddressPrefixes('unified', 'mainnet');      // ['u1']
```

---

## ShieldedTransactionBuilder

Class for building shielded withdrawal transactions with ZIP 317 fee estimation.

### Constructor

```typescript
constructor(options?: {
  minconf?: number;
  privacyPolicy?: PrivacyPolicy;
})
```

**Parameters:**
- `minconf` - Default minimum confirmations for inputs (default: 10)
- `privacyPolicy` - Default privacy policy (default: `'FullPrivacy'`)

**Example:**
```typescript
import { ShieldedTransactionBuilder } from 'exchange-shielded-sdk';

const builder = new ShieldedTransactionBuilder({
  minconf: 10,
  privacyPolicy: 'FullPrivacy'
});
```

### buildShieldedWithdrawal

Builds a pending shielded withdrawal transaction.

```typescript
buildShieldedWithdrawal(
  from: string,
  to: string,
  amount: number,
  memo?: string
): PendingTransaction
```

**Parameters:**
- `from` - Source address (must be shielded: zs, zc, or u1)
- `to` - Destination address (any valid Zcash address)
- `amount` - Amount in ZEC to withdraw
- `memo` - Optional hex-encoded memo (for shielded recipients only)

**Returns:** `PendingTransaction` - A pending transaction ready for submission

**Throws:** `TransactionBuilderError` if validation fails

**Example:**
```typescript
const tx = builder.buildShieldedWithdrawal(
  'zs1source...',
  'zs1destination...',
  10.5,
  '48656c6c6f'  // "Hello" in hex
);
```

### estimateFee

Estimates the fee for a pending transaction.

```typescript
async estimateFee(transaction: PendingTransaction): Promise<number>
```

**Parameters:**
- `transaction` - The pending transaction

**Returns:** `Promise<number>` - Estimated fee in ZEC

**Example:**
```typescript
const fee = await builder.estimateFee(tx);
console.log(`Estimated fee: ${fee} ZEC`);
```

### prepareZSendmany

Prepares a z_sendmany RPC request from a pending transaction.

```typescript
prepareZSendmany(
  tx: PendingTransaction,
  options?: {
    minconf?: number;
    fee?: number | null;
    privacyPolicy?: PrivacyPolicy;
  }
): ZSendmanyRequest
```

**Parameters:**
- `tx` - The pending transaction
- `options.minconf` - Minimum confirmations (default: builder default)
- `options.fee` - Fee in ZEC, or `null` for ZIP 317 default
- `options.privacyPolicy` - Privacy policy (default: builder default)

**Returns:** `ZSendmanyRequest` - Ready for RPC submission

### validateTransaction

Validates that a transaction can be built with the given parameters.

```typescript
validateTransaction(
  from: string,
  to: string,
  amount: number
): { valid: boolean; errors: string[] }
```

**Example:**
```typescript
const validation = builder.validateTransaction('zs1source...', 'zs1dest...', 10.5);
if (!validation.valid) {
  console.error('Errors:', validation.errors);
}
```

### Standalone Fee Functions

```typescript
// Calculate logical actions for transparent components
function calculateTransparentActions(inputCount: number, outputCount: number): number

// Calculate logical actions for Sapling components
function calculateSaplingActions(spends: number, outputs: number): number

// Calculate logical actions for Orchard components
function calculateOrchardActions(actions: number): number

// Calculate total logical actions
function calculateLogicalActions(options: FeeEstimateOptions): number

// Calculate conventional fee from logical actions
function calculateConventionalFee(logicalActions: number): number

// Estimate complete transaction fee
function estimateTransactionFee(options: FeeEstimateOptions): FeeEstimate
```

### ZIP317 Constants

```typescript
const ZIP317 = {
  MARGINAL_FEE: 5000,           // zatoshis per logical action
  GRACE_ACTIONS: 2,              // minimum actions charged
  P2PKH_INPUT_SIZE: 150,         // bytes
  P2PKH_OUTPUT_SIZE: 34,         // bytes
  MINIMUM_FEE: 10000,            // zatoshis
  ZATOSHIS_PER_ZEC: 100_000_000
};
```

---

## ZcashRpcClient

JSON-RPC client for communicating with zcashd or zebrad.

### Constructor

```typescript
constructor(config: RpcConfig, fetchFn?: FetchFunction)
```

**Parameters:**
- `config.host` - Host address (default: `'127.0.0.1'`)
- `config.port` - Port number (default: 8232 for mainnet)
- `config.auth` - Authentication credentials
- `config.timeout` - Request timeout in milliseconds (default: 30000)
- `config.https` - Use HTTPS (default: false)
- `fetchFn` - Optional custom fetch function for testing

**Example:**
```typescript
import { ZcashRpcClient, createRpcClient } from 'exchange-shielded-sdk';

const client = new ZcashRpcClient({
  host: '127.0.0.1',
  port: 8232,
  auth: { username: 'user', password: 'password' }
});

// Or use factory function
const client = createRpcClient('127.0.0.1', 8232, { username: 'user', password: 'password' });
```

### z_sendmany

Sends funds from a shielded address to multiple recipients.

```typescript
async z_sendmany(
  from: string,
  amounts: ZAmount[],
  minconf?: number,
  fee?: number | null,
  privacyPolicy?: PrivacyPolicy
): Promise<string>
```

**Parameters:**
- `from` - Source address or `'ANY_TADDR'`
- `amounts` - Array of recipient amounts
- `minconf` - Minimum confirmations (default: 10)
- `fee` - Fee in ZEC or `null` for ZIP 317 default
- `privacyPolicy` - Privacy policy (default: `'LegacyCompat'`)

**Returns:** `Promise<string>` - Operation ID to track the transaction

**Example:**
```typescript
const opid = await client.z_sendmany(
  'zs1source...',
  [{ address: 'zs1dest...', amount: 10.5, memo: '48656c6c6f' }],
  10,
  null,
  'FullPrivacy'
);
```

### executeZSendmany

Executes a z_sendmany from a prepared request.

```typescript
async executeZSendmany(request: ZSendmanyRequest): Promise<string>
```

### z_getbalance

Gets the balance of an address.

```typescript
async z_getbalance(address: string, minconf?: number): Promise<number>
```

**Parameters:**
- `address` - Transparent or shielded address
- `minconf` - Minimum confirmations (default: 1)

**Returns:** `Promise<number>` - Balance in ZEC

### z_listunspent

Lists unspent shielded notes.

```typescript
async z_listunspent(
  minconf?: number,
  maxconf?: number,
  includeWatchonly?: boolean,
  addresses?: string[]
): Promise<UnspentNote[]>
```

**Returns:** `Promise<UnspentNote[]>` - Array of unspent notes

### z_gettotalbalance

Gets the total balance across all addresses.

```typescript
async z_gettotalbalance(
  minconf?: number,
  includeWatchonly?: boolean
): Promise<TotalBalance>
```

### z_getoperationstatus

Gets the status of operations without removing them from memory.

```typescript
async z_getoperationstatus(operationIds?: string[]): Promise<OperationStatus[]>
```

### z_getoperationresult

Gets operation results and removes them from memory.

```typescript
async z_getoperationresult(operationIds?: string[]): Promise<OperationResult[]>
```

### waitForOperation

Waits for an operation to complete with polling.

```typescript
async waitForOperation(
  opid: string,
  timeoutMs?: number,
  pollIntervalMs?: number
): Promise<OperationResult>
```

**Parameters:**
- `opid` - Operation ID to wait for
- `timeoutMs` - Timeout in milliseconds (default: 300000 = 5 minutes)
- `pollIntervalMs` - Polling interval (default: 1000)

**Returns:** `Promise<OperationResult>` - The final operation result

**Throws:** `OperationTimeoutError` if timeout exceeded

### sendAndWait

Convenience method that combines z_sendmany with waitForOperation.

```typescript
async sendAndWait(
  from: string,
  amounts: ZAmount[],
  options?: {
    minconf?: number;
    fee?: number | null;
    privacyPolicy?: PrivacyPolicy;
    timeoutMs?: number;
  }
): Promise<string>
```

**Returns:** `Promise<string>` - The transaction ID

---

## SecureKeyManager

Manages spending keys in memory with strong security guarantees.

### Constructor

```typescript
constructor(config?: KeyManagerConfig)
```

**Parameters:**
- `maxKeys` - Maximum number of keys to hold in memory (default: 100)
- `autoClearAfterMs` - Auto-clear keys after inactivity (default: 0 = disabled)
- `enableUsageLogging` - Enable key usage logging (default: false)

### loadKey

Loads an encrypted key into memory.

```typescript
async loadKey(keyId: string, encryptedKey: Buffer, password: string): Promise<void>
```

**Throws:** `KeyManagerError` if decryption fails or max keys exceeded

### loadRawKey

Loads a raw (unencrypted) key into memory.

```typescript
loadRawKey(
  keyId: string,
  keyBytes: Buffer,
  keyType: 'sapling' | 'orchard' | 'unified'
): void
```

**Warning:** Only use in secure environments where keys are already protected.

### signTransaction

Signs transaction data with a key.

```typescript
signTransaction(keyId: string, txData: Buffer): Buffer
```

**Returns:** `Buffer` - The signature

**Throws:** `KeyManagerError` if key not found

### clearKey

Clears a specific key from memory.

```typescript
clearKey(keyId: string): boolean
```

**Returns:** `boolean` - `true` if key was cleared, `false` if not found

### clearAllKeys

Clears all keys from memory.

```typescript
clearAllKeys(): void
```

### getKeyMetadata

Gets metadata for a loaded key (without exposing key bytes).

```typescript
getKeyMetadata(keyId: string): SpendingKey | undefined
```

### Other Methods

```typescript
getKeyCount(): number
listKeyIds(): string[]
hasKey(keyId: string): boolean
async encryptKeyForStorage(keyBytes: Buffer, password: string): Promise<Buffer>
```

---

## WithdrawalRateLimiter

Enforces rate limits on withdrawal operations per user.

### Constructor

```typescript
constructor(config?: Partial<RateLimitConfig>, getNow?: () => number)
```

**Default Configuration:**
```typescript
{
  maxWithdrawalsPerHour: 10,
  maxWithdrawalsPerDay: 50,
  maxAmountPerWithdrawal: 100,      // ZEC
  maxTotalAmountPerDay: 1000,       // ZEC
  cooldownMs: 60000,                 // 1 minute
  useSlidingWindow: true
}
```

### checkLimit

Checks if a withdrawal is allowed for a user.

```typescript
checkLimit(userId: string, amount: number): RateLimitResult
```

**Returns:** `RateLimitResult` - Contains `allowed`, `reason`, `retryAfterMs`, and `usage`

**Example:**
```typescript
const result = limiter.checkLimit('user-123', 5.0);
if (result.allowed) {
  // Process withdrawal
  limiter.recordWithdrawal('user-123', 5.0);
} else {
  console.log('Rate limited:', result.reason);
  if (result.retryAfterMs) {
    console.log(`Retry after ${result.retryAfterMs}ms`);
  }
}
```

### recordWithdrawal

Records a successful withdrawal.

```typescript
recordWithdrawal(userId: string, amount: number): void
```

### getRemainingLimit

Gets the remaining limits for a user.

```typescript
getRemainingLimit(userId: string): RemainingLimit
```

**Returns:** `RemainingLimit` - Detailed remaining limits and reset times

### resetUser

Resets the rate limit state for a user.

```typescript
resetUser(userId: string): void
```

### resetAll

Resets all rate limit state.

```typescript
resetAll(): void
```

### Pre-configured Limiters

```typescript
// Conservative limits for high-security scenarios
const conservative = createConservativeRateLimiter();
// maxWithdrawalsPerHour: 3, maxWithdrawalsPerDay: 10
// maxAmountPerWithdrawal: 10, maxTotalAmountPerDay: 50
// cooldownMs: 300000 (5 minutes)

// High-volume limits for busy exchanges
const highVolume = createHighVolumeRateLimiter();
// maxWithdrawalsPerHour: 100, maxWithdrawalsPerDay: 500
// maxAmountPerWithdrawal: 1000, maxTotalAmountPerDay: 10000
// cooldownMs: 10000 (10 seconds)
```

---

## AuditLogger

Provides tamper-evident audit logging with cryptographic integrity.

### Constructor

```typescript
constructor(config?: AuditConfig)
```

**Parameters:**
- `maxEvents` - Maximum events to store in memory (default: 100000)
- `minSeverity` - Minimum severity level to log (default: `INFO`)
- `autoRedact` - Automatically redact sensitive data (default: true)
- `onEvent` - Custom event handler for external logging
- `verifyChainOnLog` - Verify chain integrity on each log (default: false)

### log

Logs an audit event.

```typescript
log(event: Omit<AuditEvent, 'id' | 'timestamp' | 'previousHash' | 'hash'>): AuditEvent
```

**Parameters:**
- `eventType` - Type of event (from `AuditEventType` enum)
- `severity` - Event severity (from `AuditSeverity` enum)
- `userId` - Optional user ID
- `transactionId` - Optional transaction ID
- `amount` - Optional amount in ZEC
- `destinationAddress` - Optional destination address (auto-redacted if shielded)
- `metadata` - Optional additional metadata

**Returns:** `AuditEvent` - The logged event with computed hash

**Example:**
```typescript
const logger = new AuditLogger();

logger.log({
  eventType: AuditEventType.WITHDRAWAL_REQUESTED,
  severity: AuditSeverity.INFO,
  userId: 'user-123',
  amount: 10.5,
  destinationAddress: 'zs1dest...',
  metadata: { requestId: 'req-123' }
});
```

### getEvents

Gets events matching the given filter.

```typescript
getEvents(filter?: AuditFilter): AuditEvent[]
```

**Filter Options:**
- `eventTypes` - Filter by event type(s)
- `minSeverity` - Minimum severity level
- `userId` - Filter by user ID
- `transactionId` - Filter by transaction ID
- `startDate` / `endDate` - Time range
- `limit` / `offset` - Pagination

### exportForCompliance

Exports events for compliance review.

```typescript
exportForCompliance(startDate: Date, endDate: Date): ComplianceReport
```

**Returns:** `ComplianceReport` - Complete report with statistics and integrity verification

### verifyIntegrity

Verifies the integrity of the audit log chain.

```typescript
verifyIntegrity(): { valid: boolean; brokenAt?: number }
```

### AuditEventType Enum

```typescript
enum AuditEventType {
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_APPROVED = 'WITHDRAWAL_APPROVED',
  WITHDRAWAL_COMPLETED = 'WITHDRAWAL_COMPLETED',
  WITHDRAWAL_FAILED = 'WITHDRAWAL_FAILED',
  WITHDRAWAL_CANCELLED = 'WITHDRAWAL_CANCELLED',
  KEY_LOADED = 'KEY_LOADED',
  KEY_CLEARED = 'KEY_CLEARED',
  KEY_ACCESS = 'KEY_ACCESS',
  RATE_LIMIT_HIT = 'RATE_LIMIT_HIT',
  RATE_LIMIT_RESET = 'RATE_LIMIT_RESET',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  CONFIGURATION_CHANGED = 'CONFIGURATION_CHANGED',
  COMPLIANCE_CHECK = 'COMPLIANCE_CHECK',
  VIEWING_KEY_EXPORTED = 'VIEWING_KEY_EXPORTED',
  REPORT_GENERATED = 'REPORT_GENERATED'
}
```

### AuditSeverity Enum

```typescript
enum AuditSeverity {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL'
}
```

---

## ComplianceManager

Handles compliance-related operations including viewing key export, velocity checks, and suspicious activity detection.

### Constructor

```typescript
constructor(config?: ComplianceConfig)
```

**Parameters:**
- `velocityThresholds` - Custom velocity thresholds
- `viewingKeyValidityMs` - Viewing key export validity period (default: 24 hours)
- `auditLogger` - Custom audit logger instance

### exportViewingKey

Exports a viewing key for compliance/audit purposes.

```typescript
exportViewingKey(spendingKeyId: string, purpose?: string): ViewingKeyExport
```

**Returns:** `ViewingKeyExport` - Exported key with checksum and expiration

### exportViewingKeys

Exports all viewing keys as a bundle.

```typescript
exportViewingKeys(purpose?: string): ViewingKeyBundle
```

### registerViewingKey

Registers a viewing key for later export.

```typescript
registerViewingKey(
  spendingKeyId: string,
  viewingKey: string,
  keyType: 'sapling' | 'orchard' | 'unified'
): void
```

### checkVelocity

Checks velocity for a user before processing a withdrawal.

```typescript
checkVelocity(userId: string, amount: number): VelocityCheckResult
```

**Returns:** `VelocityCheckResult` - Contains `passed`, `velocity`, `thresholds`, `reason`, and `riskScore`

**Example:**
```typescript
const result = compliance.checkVelocity('user-123', 50.0);
if (!result.passed) {
  console.log('Velocity check failed:', result.reason);
  console.log('Risk score:', result.riskScore);
}
```

### recordTransaction

Records a transaction for velocity tracking.

```typescript
recordTransaction(userId: string, amount: number): void
```

### flagSuspiciousActivity

Flags suspicious activity for a user.

```typescript
flagSuspiciousActivity(
  userId: string,
  reason: string,
  details?: Record<string, unknown>
): SuspiciousActivityFlag
```

### getUserFlags

Gets all flags for a user.

```typescript
getUserFlags(userId: string, includeReviewed?: boolean): SuspiciousActivityFlag[]
```

### reviewFlag

Marks a flag as reviewed.

```typescript
reviewFlag(flagId: string, notes: string): boolean
```

### generateComplianceReport

Generates a compliance report for a given period.

```typescript
generateComplianceReport(period: DateRange): ComplianceReport
```

### getStatistics

Gets summary statistics.

```typescript
getStatistics(): {
  totalTransactionsTracked: number;
  totalFlagsActive: number;
  totalFlagsReviewed: number;
  registeredViewingKeys: number;
}
```

---

## ExchangeShieldedSDK

High-level SDK wrapper for exchange integration with shielded withdrawals.

### Constructor

```typescript
constructor(config: SDKConfig)
```

See [SDK Configuration](#sdk-configuration) in README for full options.

### processWithdrawal

Processes a withdrawal request end-to-end.

```typescript
async processWithdrawal(request: WithdrawalRequest): Promise<WithdrawalResult>
```

**Process:**
1. Validates and sanitizes all inputs
2. Checks rate limits
3. Performs velocity checks (if compliance enabled)
4. Builds the transaction
5. Submits to the network
6. Waits for completion
7. Logs all events

**Example:**
```typescript
const result = await sdk.processWithdrawal({
  userId: 'user-123',
  fromAddress: 'zs1source...',
  toAddress: 'zs1dest...',
  amount: 10.5,
  memo: '48656c6c6f',
  requestId: 'custom-id-123'
});

if (result.success) {
  console.log('Transaction ID:', result.transactionId);
  console.log('Fee paid:', result.fee);
} else {
  console.error('Failed:', result.error, result.errorCode);
}
```

### getWithdrawalStatus

Gets the status of a withdrawal by transaction ID.

```typescript
async getWithdrawalStatus(txId: string): Promise<WithdrawalStatus>
```

### estimateWithdrawalFee

Estimates the fee for a withdrawal.

```typescript
async estimateWithdrawalFee(amount: number, destination: string): Promise<FeeEstimate>
```

### getComplianceReport

Gets a compliance report for a given period.

```typescript
async getComplianceReport(period: DateRange): Promise<ComplianceReport>
```

### exportViewingKeys

Exports viewing keys for compliance purposes.

```typescript
async exportViewingKeys(): Promise<ViewingKeyBundle>
```

### checkRateLimit

Checks rate limit status for a user.

```typescript
checkRateLimit(userId: string, amount: number): RateLimitResult
```

### checkVelocity

Checks velocity for a user.

```typescript
checkVelocity(userId: string, amount: number): VelocityCheckResult
```

### Accessor Methods

```typescript
getKeyManager(): SecureKeyManager
getAuditLogger(): AuditLogger
getComplianceManager(): ComplianceManager
```

---

## Types and Interfaces

### Address Types

```typescript
type AddressType = 'transparent' | 'sprout' | 'sapling' | 'orchard' | 'unified' | 'unknown';

interface UnifiedAddressComponents {
  transparent?: string;
  sapling?: string;
  orchard?: boolean;
}

interface AddressValidationResult {
  valid: boolean;
  type: AddressType;
  shielded: boolean;
  network: 'mainnet' | 'testnet' | 'unknown';
  error?: string;
}
```

### Transaction Types

```typescript
interface PendingTransaction {
  from: string;
  to: string;
  amount: number;
  memo?: string;
  fee?: number;
  createdAt: number;
  fromType: AddressType;
  toType: AddressType;
}

interface ZAmount {
  address: string;
  amount: number;
  memo?: string;
}

type PrivacyPolicy =
  | 'FullPrivacy'
  | 'LegacyCompat'
  | 'AllowRevealedAmounts'
  | 'AllowRevealedRecipients'
  | 'AllowRevealedSenders'
  | 'AllowFullyTransparent'
  | 'AllowLinkingAccountAddresses'
  | 'NoPrivacy';

interface FeeEstimate {
  zatoshis: number;
  zec: number;
  logicalActions: number;
  breakdown: {
    transparent: number;
    sapling: number;
    orchard: number;
  };
}
```

### RPC Types

```typescript
interface RpcConfig {
  host: string;
  port: number;
  auth: RpcAuth;
  timeout?: number;
  https?: boolean;
}

interface RpcAuth {
  username: string;
  password: string;
}

interface UnspentNote {
  txid: string;
  pool: 'sprout' | 'sapling' | 'orchard';
  confirmations: number;
  spendable: boolean;
  address?: string;
  amount: number;
  memo: string;
  change: boolean;
}

interface TotalBalance {
  transparent: string;
  private: string;
  total: string;
}

interface OperationStatus {
  id: string;
  status: 'queued' | 'executing' | 'success' | 'failed' | 'cancelled';
  creation_time: number;
  method: string;
  params: unknown;
  error?: { code: number; message: string };
}
```

### Security Types

```typescript
interface SpendingKey {
  readonly id: string;
  readonly keyType: 'sapling' | 'orchard' | 'unified';
  readonly createdAt: number;
  lastUsedAt?: number;
}

interface KeyManagerConfig {
  maxKeys?: number;
  autoClearAfterMs?: number;
  enableUsageLogging?: boolean;
}

interface RateLimitConfig {
  maxWithdrawalsPerHour: number;
  maxWithdrawalsPerDay: number;
  maxAmountPerWithdrawal: number;
  maxTotalAmountPerDay: number;
  cooldownMs: number;
  useSlidingWindow?: boolean;
}

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
  usage: RateLimitUsage;
}

interface SanitizedAddress {
  address: string;
  valid: boolean;
  type: AddressType;
  error?: string;
}
```

### Compliance Types

```typescript
interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  severity: AuditSeverity;
  userId?: string;
  transactionId?: string;
  amount?: number;
  destinationAddress?: string;
  metadata?: Record<string, unknown>;
  previousHash?: string;
  hash?: string;
}

interface ComplianceReport {
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  summary: {
    totalEvents: number;
    withdrawalCount: number;
    totalWithdrawnAmount: number;
    failedWithdrawals: number;
    rateLimitHits: number;
    suspiciousActivityCount: number;
  };
  eventsByType: Record<AuditEventType, number>;
  eventsBySeverity: Record<AuditSeverity, number>;
  events: AuditEvent[];
  integrityCheck: {
    valid: boolean;
    firstEventHash: string;
    lastEventHash: string;
    chainVerified: boolean;
  };
}

interface VelocityCheckResult {
  passed: boolean;
  velocity: {
    lastHour: number;
    last24Hours: number;
    amountLastHour: number;
    amountLast24Hours: number;
  };
  thresholds: VelocityThresholds;
  reason?: string;
  riskScore: number;
}

interface ViewingKeyExport {
  keyId: string;
  viewingKey: string;
  keyType: 'sapling' | 'orchard' | 'unified';
  exportedAt: Date;
  expiresAt?: Date;
  purpose: string;
  checksum: string;
}
```

### SDK Types

```typescript
interface SDKConfig {
  rpc: RpcConfig;
  keyManager?: KeyManagerConfig;
  rateLimiter?: Partial<RateLimitConfig>;
  enableCompliance?: boolean;
  enableAuditLogging?: boolean;
  minconf?: number;
  privacyPolicy?: PrivacyPolicy;
}

interface WithdrawalRequest {
  userId: string;
  fromAddress: string;
  toAddress: string;
  amount: number;
  memo?: string;
  requestId?: string;
}

interface WithdrawalResult {
  success: boolean;
  transactionId?: string;
  operationId?: string;
  error?: string;
  errorCode?: string;
  fee?: number;
  requestId?: string;
  completedAt?: Date;
}

interface WithdrawalStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'unknown';
  transactionId?: string;
  confirmations?: number;
  error?: string;
  updatedAt: Date;
}
```

---

## Error Classes

### TransactionBuilderError

```typescript
class TransactionBuilderError extends Error {
  readonly code: string;
}
```

**Error Codes:**
- `INVALID_FROM_ADDRESS` - Invalid source address
- `NOT_SHIELDED_SOURCE` - Source must be shielded
- `INVALID_TO_ADDRESS` - Invalid destination address
- `INVALID_AMOUNT` - Invalid amount
- `MEMO_NOT_ALLOWED` - Memo only for shielded recipients
- `INVALID_MEMO_FORMAT` - Memo must be hex-encoded
- `MEMO_TOO_LONG` - Memo exceeds 512 bytes

### RpcError

```typescript
class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
}
```

### OperationTimeoutError

```typescript
class OperationTimeoutError extends Error {
  readonly operationId: string;
  readonly timeoutMs: number;
}
```

### KeyManagerError

```typescript
class KeyManagerError extends Error {
  readonly code: string;
}
```

**Error Codes:**
- `MAX_KEYS_EXCEEDED` - Maximum keys limit reached
- `KEY_ALREADY_EXISTS` - Key ID already loaded
- `KEY_NOT_FOUND` - Key not found
- `DECRYPTION_FAILED` - Failed to decrypt key
- `SIGNING_FAILED` - Failed to sign transaction
- `INVALID_FORMAT` - Invalid encrypted key format
