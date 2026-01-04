# Security Best Practices

Comprehensive security guide for deploying the Exchange Shielded SDK in production environments.

## Table of Contents

- [Key Management](#key-management)
- [Rate Limiting Configuration](#rate-limiting-configuration)
- [Audit Logging Setup](#audit-logging-setup)
- [Compliance Requirements](#compliance-requirements)
- [Common Pitfalls to Avoid](#common-pitfalls-to-avoid)
- [Security Checklist](#security-checklist)

---

## Key Management

### Secure Key Storage

The SDK provides `SecureKeyManager` for handling spending keys with strong security guarantees.

#### Encryption at Rest

Keys are encrypted using AES-256-GCM with scrypt key derivation:

```typescript
import { SecureKeyManager } from 'exchange-shielded-sdk';

const keyManager = new SecureKeyManager({
  maxKeys: 10,                    // Limit keys in memory
  autoClearAfterMs: 3600000,      // Clear after 1 hour of inactivity
  enableUsageLogging: true         // Log key usage (not key data)
});

// Encrypt a key for storage
const encryptedKey = await keyManager.encryptKeyForStorage(
  rawKeyBytes,
  'strong-password-from-hsm'
);

// Store encryptedKey in secure storage (HSM, Vault, etc.)
await secureStorage.store('key-id', encryptedKey);
```

#### Loading Keys

```typescript
// Load encrypted key from secure storage
const encryptedKey = await secureStorage.retrieve('key-id');

// Decrypt and load into memory
await keyManager.loadKey('key-id', encryptedKey, password);

// Use for signing
const signature = keyManager.signTransaction('key-id', txData);

// Clear when done
keyManager.clearKey('key-id');
```

### Best Practices

#### 1. Use Hardware Security Modules (HSM)

```typescript
// Retrieve key from HSM
const keyBytes = await hsm.getKey('zcash-spending-key');

// Load temporarily for signing
keyManager.loadRawKey('temp-key', keyBytes, 'sapling');

try {
  const signature = keyManager.signTransaction('temp-key', txData);
  return signature;
} finally {
  // Always clear immediately after use
  keyManager.clearKey('temp-key');
  // Zero the buffer
  keyBytes.fill(0);
}
```

#### 2. Minimize Key Exposure Time

```typescript
// BAD: Loading key at startup and keeping in memory
const keyManager = new SecureKeyManager();
await keyManager.loadKey('hot-wallet', encryptedKey, password);
// Key stays in memory indefinitely

// GOOD: Load only when needed
async function processWithdrawal(txData: Buffer): Promise<Buffer> {
  const keyManager = new SecureKeyManager({ autoClearAfterMs: 60000 });

  try {
    await keyManager.loadKey('hot-wallet', encryptedKey, password);
    return keyManager.signTransaction('hot-wallet', txData);
  } finally {
    keyManager.clearAllKeys();
  }
}
```

#### 3. Never Log Keys

The SDK automatically prevents key logging:

```typescript
const keyManager = new SecureKeyManager();

// Keys are never exposed in:
console.log(keyManager);              // [SecureKeyManager: 2 keys loaded]
JSON.stringify(keyManager);           // {"type":"SecureKeyManager","keyCount":2,...}
keyManager.getKeyMetadata('key-1');   // Only returns id, type, timestamps

// Error messages are sanitized:
try {
  keyManager.loadKey('id', invalidData, 'pass');
} catch (error) {
  console.log(error.message);  // "Failed to load key: decryption error"
  // No key data in error
}
```

#### 4. Separate Hot and Cold Wallets

```
                     +------------------+
                     |   Cold Wallet    |
                     | (Air-gapped HSM) |
                     +--------+---------+
                              |
                    Manual transfer (large amounts)
                              |
                     +--------v---------+
                     |   Hot Wallet     |
                     | (SDK-managed)    |
                     +--------+---------+
                              |
                    Automated withdrawals
                              |
                     +--------v---------+
                     |   User Wallets   |
                     +------------------+
```

---

## Rate Limiting Configuration

### Configuring Rate Limits

```typescript
import {
  WithdrawalRateLimiter,
  createConservativeRateLimiter,
  createHighVolumeRateLimiter
} from 'exchange-shielded-sdk';

// Custom configuration
const limiter = new WithdrawalRateLimiter({
  maxWithdrawalsPerHour: 10,
  maxWithdrawalsPerDay: 50,
  maxAmountPerWithdrawal: 100,      // ZEC
  maxTotalAmountPerDay: 1000,       // ZEC
  cooldownMs: 60000,                 // 1 minute between withdrawals
  useSlidingWindow: true             // More accurate than fixed windows
});
```

### Tiered Rate Limits

Implement different limits based on user verification level:

```typescript
function getRateLimiterForUser(user: User): WithdrawalRateLimiter {
  switch (user.verificationLevel) {
    case 'basic':
      return new WithdrawalRateLimiter({
        maxWithdrawalsPerHour: 2,
        maxWithdrawalsPerDay: 5,
        maxAmountPerWithdrawal: 10,
        maxTotalAmountPerDay: 50,
        cooldownMs: 300000  // 5 minutes
      });

    case 'verified':
      return new WithdrawalRateLimiter({
        maxWithdrawalsPerHour: 10,
        maxWithdrawalsPerDay: 50,
        maxAmountPerWithdrawal: 100,
        maxTotalAmountPerDay: 1000,
        cooldownMs: 60000
      });

    case 'institutional':
      return createHighVolumeRateLimiter();

    default:
      return createConservativeRateLimiter();
  }
}
```

### Implementing Rate Limit Responses

```typescript
async function handleWithdrawal(request: WithdrawalRequest): Promise<Response> {
  const limiter = getRateLimiterForUser(request.user);
  const check = limiter.checkLimit(request.userId, request.amount);

  if (!check.allowed) {
    // Log rate limit hit
    auditLogger.log({
      eventType: AuditEventType.RATE_LIMIT_HIT,
      severity: AuditSeverity.WARNING,
      userId: request.userId,
      amount: request.amount,
      metadata: {
        reason: check.reason,
        usage: check.usage
      }
    });

    // Return appropriate response
    if (check.retryAfterMs) {
      return {
        status: 429,
        headers: { 'Retry-After': Math.ceil(check.retryAfterMs / 1000) },
        body: { error: check.reason }
      };
    }

    return { status: 429, body: { error: check.reason } };
  }

  // Process withdrawal...
  const result = await processWithdrawal(request);

  // Record successful withdrawal
  if (result.success) {
    limiter.recordWithdrawal(request.userId, request.amount);
  }

  return result;
}
```

### Rate Limit Monitoring

```typescript
// Expose rate limit status to users
function getUserLimitStatus(userId: string): RateLimitStatus {
  const remaining = limiter.getRemainingLimit(userId);

  return {
    withdrawalsRemainingHour: remaining.withdrawalsRemainingHour,
    withdrawalsRemainingDay: remaining.withdrawalsRemainingDay,
    maxSingleWithdrawal: remaining.maxSingleWithdrawal,
    amountRemainingToday: remaining.amountRemainingToday,
    cooldownSeconds: Math.ceil(remaining.cooldownRemainingMs / 1000),
    hourResetsAt: new Date(remaining.hourResetAt),
    dayResetsAt: new Date(remaining.dayResetAt)
  };
}
```

---

## Audit Logging Setup

### Basic Configuration

```typescript
import { AuditLogger, AuditEventType, AuditSeverity } from 'exchange-shielded-sdk';

const auditLogger = new AuditLogger({
  maxEvents: 100000,                // Store up to 100k events in memory
  minSeverity: AuditSeverity.INFO,  // Log INFO and above
  autoRedact: true,                  // Automatically redact sensitive data
  verifyChainOnLog: true,            // Verify chain integrity on each log
  onEvent: async (event) => {
    // Ship to external logging system
    await externalLogger.send(event);
  }
});
```

### Logging Withdrawal Events

```typescript
// Log withdrawal request
auditLogger.log({
  eventType: AuditEventType.WITHDRAWAL_REQUESTED,
  severity: AuditSeverity.INFO,
  userId: request.userId,
  amount: request.amount,
  destinationAddress: request.toAddress,
  metadata: {
    requestId: request.id,
    sourceIP: request.ip,
    userAgent: request.userAgent
  }
});

// Log approval
auditLogger.log({
  eventType: AuditEventType.WITHDRAWAL_APPROVED,
  severity: AuditSeverity.INFO,
  userId: request.userId,
  amount: request.amount,
  metadata: {
    requestId: request.id,
    approvedBy: 'system',
    checks: { rateLimit: 'passed', velocity: 'passed' }
  }
});

// Log completion
auditLogger.log({
  eventType: AuditEventType.WITHDRAWAL_COMPLETED,
  severity: AuditSeverity.INFO,
  userId: request.userId,
  transactionId: result.txId,
  amount: request.amount,
  destinationAddress: request.toAddress,
  metadata: {
    requestId: request.id,
    fee: result.fee,
    executionTimeMs: result.executionTime
  }
});
```

### External Log Shipping

```typescript
// Ship logs to Elasticsearch
const auditLogger = new AuditLogger({
  onEvent: async (event) => {
    await elasticClient.index({
      index: 'zcash-audit-logs',
      document: {
        ...event,
        '@timestamp': event.timestamp
      }
    });
  }
});

// Ship logs to Splunk
const auditLogger = new AuditLogger({
  onEvent: async (event) => {
    await splunkClient.send({
      sourcetype: 'zcash:audit',
      event: event
    });
  }
});
```

### Integrity Verification

```typescript
// Periodic integrity check
async function verifyAuditIntegrity(): Promise<void> {
  const result = auditLogger.verifyIntegrity();

  if (!result.valid) {
    // CRITICAL: Audit log tampered
    await alertSecurityTeam({
      severity: 'CRITICAL',
      message: `Audit log integrity compromised at event ${result.brokenAt}`,
      action: 'IMMEDIATE_INVESTIGATION_REQUIRED'
    });

    // Halt withdrawals
    await pauseWithdrawals();
  }
}

// Run every hour
setInterval(verifyAuditIntegrity, 3600000);
```

### Compliance Reporting

```typescript
// Generate monthly compliance report
async function generateMonthlyReport(year: number, month: number): Promise<void> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const report = auditLogger.exportForCompliance(startDate, endDate);

  // Archive report
  await archiveReport({
    period: `${year}-${month}`,
    report: report,
    generatedAt: new Date()
  });

  // Alert if issues detected
  if (report.summary.suspiciousActivityCount > 0) {
    await notifyComplianceTeam({
      message: `${report.summary.suspiciousActivityCount} suspicious activities flagged`,
      report: report
    });
  }
}
```

---

## Compliance Requirements

### Velocity Checks

```typescript
import { ComplianceManager } from 'exchange-shielded-sdk';

const compliance = new ComplianceManager({
  velocityThresholds: {
    maxTransactionsPerHour: 10,
    maxTransactionsPerDay: 50,
    maxAmountPerHour: 100,      // ZEC
    maxAmountPerDay: 1000       // ZEC
  }
});

// Check before processing
const velocityCheck = compliance.checkVelocity(userId, amount);

if (!velocityCheck.passed) {
  // Flag for review
  compliance.flagSuspiciousActivity(
    userId,
    velocityCheck.reason || 'Velocity threshold exceeded',
    {
      requestedAmount: amount,
      velocity: velocityCheck.velocity,
      riskScore: velocityCheck.riskScore
    }
  );

  // Require manual approval for high-risk
  if (velocityCheck.riskScore > 70) {
    return { requiresManualApproval: true };
  }
}
```

### Suspicious Activity Detection

```typescript
// Automatic flagging based on patterns
function checkForSuspiciousPatterns(request: WithdrawalRequest): void {
  // Multiple withdrawals to same address
  const recentWithdrawals = getRecentWithdrawals(request.userId, 24);
  const sameAddressCount = recentWithdrawals.filter(
    w => w.toAddress === request.toAddress
  ).length;

  if (sameAddressCount >= 3) {
    compliance.flagSuspiciousActivity(
      request.userId,
      'Multiple withdrawals to same address',
      { address: request.toAddress, count: sameAddressCount }
    );
  }

  // Withdrawal just under limit
  const limit = getRateLimiter(request.userId).getConfig().maxAmountPerWithdrawal;
  if (request.amount > limit * 0.9 && request.amount < limit) {
    compliance.flagSuspiciousActivity(
      request.userId,
      'Withdrawal amount suspiciously close to limit',
      { amount: request.amount, limit }
    );
  }

  // First withdrawal to new address with large amount
  const isNewAddress = !hasWithdrawnToAddress(request.userId, request.toAddress);
  if (isNewAddress && request.amount > 50) {
    compliance.flagSuspiciousActivity(
      request.userId,
      'Large withdrawal to new address',
      { amount: request.amount, address: request.toAddress }
    );
  }
}
```

### Viewing Key Export for Auditors

```typescript
// Export viewing keys for regulatory compliance
async function exportForRegulator(purpose: string): Promise<ViewingKeyBundle> {
  // Require high-privilege authentication
  await requireAdminApproval('viewing-key-export');

  const bundle = compliance.exportViewingKeys(purpose);

  // Log the export
  auditLogger.log({
    eventType: AuditEventType.VIEWING_KEY_EXPORTED,
    severity: AuditSeverity.WARNING,
    metadata: {
      bundleId: bundle.bundleId,
      purpose,
      keyCount: bundle.keys.length,
      exportedBy: getCurrentAdmin()
    }
  });

  return bundle;
}
```

---

## Common Pitfalls to Avoid

### 1. Logging Sensitive Data

```typescript
// BAD: Logging raw request with keys
console.log('Processing withdrawal:', request);

// GOOD: Use redaction
import { redactSensitiveData } from 'exchange-shielded-sdk';
console.log('Processing withdrawal:', redactSensitiveData(request));
// Output: { userId: 'user...123', amount: 10, toAddress: 'zs1a...bcd' }
```

### 2. Storing Keys in Environment Variables

```typescript
// BAD: Keys in environment
const key = Buffer.from(process.env.SPENDING_KEY!, 'hex');

// GOOD: Use secure key management
const encryptedKey = await vault.getSecret('zcash/spending-key');
await keyManager.loadKey('wallet', encryptedKey, password);
```

### 3. Ignoring Rate Limit Results

```typescript
// BAD: Only checking, not enforcing
const check = limiter.checkLimit(userId, amount);
processWithdrawal(request);  // Proceeds regardless

// GOOD: Enforce limits
const check = limiter.checkLimit(userId, amount);
if (!check.allowed) {
  throw new RateLimitError(check.reason);
}
processWithdrawal(request);
```

### 4. Not Validating Addresses

```typescript
// BAD: Trusting user input
const request = {
  toAddress: userInput.address,  // Could be malformed
  amount: userInput.amount
};

// GOOD: Validate all inputs
import { sanitizeAddress, sanitizeAmount } from 'exchange-shielded-sdk';

const addressResult = sanitizeAddress(userInput.address);
if (!addressResult.valid) {
  throw new ValidationError(addressResult.error);
}

const amountResult = sanitizeAmount(userInput.amount);
if (!amountResult.valid) {
  throw new ValidationError(amountResult.error);
}
```

### 5. Insufficient Confirmations

```typescript
// BAD: Using low confirmation count
const balance = await rpcClient.z_getbalance(address, 1);

// GOOD: Use appropriate confirmations for security
const SAFE_CONFIRMATIONS = 10;  // ~25 minutes
const balance = await rpcClient.z_getbalance(address, SAFE_CONFIRMATIONS);
```

### 6. Not Handling RPC Timeouts

```typescript
// BAD: No timeout handling
const result = await rpcClient.waitForOperation(opid);

// GOOD: Handle timeouts appropriately
try {
  const result = await rpcClient.waitForOperation(opid, 300000);  // 5 min timeout
} catch (error) {
  if (error instanceof OperationTimeoutError) {
    // Log and alert - operation may still complete
    await alertOperationsTeam({
      message: `Operation ${opid} timed out after 5 minutes`,
      action: 'Manual verification required'
    });
  }
  throw error;
}
```

---

## Security Checklist

### Development

- [ ] All dependencies audited for vulnerabilities (`npm audit`)
- [ ] No secrets in source code or environment variables
- [ ] Input validation on all user-provided data
- [ ] Error messages do not leak sensitive information
- [ ] Unit tests cover security-critical paths
- [ ] Code review includes security review

### Deployment

- [ ] HTTPS enforced for all external communication
- [ ] RPC credentials from secure secrets manager
- [ ] Firewall restricts RPC access to application servers only
- [ ] Container runs as non-root user
- [ ] Read-only filesystem where possible
- [ ] Resource limits configured (CPU, memory)

### Operations

- [ ] Rate limiting enabled and configured appropriately
- [ ] Audit logging enabled with external log shipping
- [ ] Monitoring alerts for:
  - [ ] Node sync status
  - [ ] Hot wallet balance
  - [ ] Rate limit threshold approaching
  - [ ] Suspicious activity flags
  - [ ] Audit log integrity failures
- [ ] Incident response procedure documented
- [ ] Key rotation procedure documented
- [ ] Backup and recovery tested

### Compliance

- [ ] Audit log retention meets regulatory requirements
- [ ] Viewing key export procedure documented
- [ ] Compliance reporting automated
- [ ] Suspicious activity review workflow in place
- [ ] Data retention and deletion procedures

### Regular Reviews

- [ ] Weekly: Review suspicious activity flags
- [ ] Monthly: Generate and review compliance report
- [ ] Monthly: Verify audit log integrity
- [ ] Quarterly: Security audit of configuration
- [ ] Annually: Full security assessment
