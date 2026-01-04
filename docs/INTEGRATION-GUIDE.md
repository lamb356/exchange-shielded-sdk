# Exchange Integration Guide

A step-by-step guide for integrating the Exchange Shielded SDK into your cryptocurrency exchange.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Architecture Overview](#architecture-overview)
- [Step-by-Step Integration](#step-by-step-integration)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### 1. Zcash Node Setup

You need a running zcashd or zebrad instance with RPC enabled.

#### zcashd Installation

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install zcash

# Configure zcashd
mkdir -p ~/.zcash
cat > ~/.zcash/zcash.conf << EOF
# Network
mainnet=1
addnode=mainnet.z.cash

# RPC Configuration
server=1
rpcuser=your_rpc_username
rpcpassword=your_secure_password
rpcport=8232
rpcbind=127.0.0.1
rpcallowip=127.0.0.1

# Security
disablewallet=0

# Performance
dbcache=4096
maxconnections=40
EOF

# Start zcashd
zcashd -daemon
```

#### Zebrad Alternative

```bash
# Install zebrad
cargo install zebrad

# Configure zebrad with RPC
cat > ~/.config/zebrad.toml << EOF
[network]
network = "Mainnet"

[rpc]
listen_addr = "127.0.0.1:8232"
EOF

zebrad start
```

### 2. Node.js Environment

```bash
# Verify Node.js version (18+ required)
node --version

# Install SDK
npm install exchange-shielded-sdk
```

### 3. Create Shielded Addresses

Before processing withdrawals, you need shielded addresses to hold funds:

```bash
# Using zcash-cli
zcash-cli z_getnewaddress sapling
# Returns: zs1...

# For unified addresses (NU5+)
zcash-cli z_getnewaddress
# Returns: u1...
```

---

## Architecture Overview

### Recommended Architecture

```
                                    +------------------+
                                    |   Exchange DB    |
                                    | (Users, Balances)|
                                    +--------+---------+
                                             |
+------------------+    +------------------+ |  +------------------+
|   Web Frontend   |--->|   API Server     |-+->| Exchange Shielded|
|   (User Portal)  |    | (Your Backend)   |    |       SDK        |
+------------------+    +--------+---------+    +--------+---------+
                                 |                       |
                        +--------+---------+    +--------+---------+
                        | Rate Limiting &  |    |     zcashd       |
                        | Compliance Check |    |   (Full Node)    |
                        +------------------+    +------------------+
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| Web Frontend | User withdrawal requests |
| API Server | Authentication, authorization, request handling |
| Exchange Shielded SDK | Transaction building, RPC communication, security |
| zcashd | Blockchain interaction, transaction signing |
| Exchange DB | User balances, withdrawal history |

---

## Step-by-Step Integration

### Step 1: Initialize the SDK

```typescript
// src/services/zcash-withdrawal.ts
import { createExchangeSDK, SDKConfig } from 'exchange-shielded-sdk';

// Load configuration from environment
const config: SDKConfig = {
  rpc: {
    host: process.env.ZCASH_RPC_HOST || '127.0.0.1',
    port: parseInt(process.env.ZCASH_RPC_PORT || '8232'),
    auth: {
      username: process.env.ZCASH_RPC_USER || '',
      password: process.env.ZCASH_RPC_PASSWORD || ''
    },
    timeout: 30000,
    https: false
  },
  rateLimiter: {
    maxWithdrawalsPerHour: 10,
    maxWithdrawalsPerDay: 50,
    maxAmountPerWithdrawal: 100,
    maxTotalAmountPerDay: 1000,
    cooldownMs: 60000
  },
  enableCompliance: true,
  enableAuditLogging: true,
  minconf: 10,
  privacyPolicy: 'FullPrivacy'
};

// Create singleton SDK instance
export const zcashSDK = createExchangeSDK(config);
```

### Step 2: Create Withdrawal Endpoint

```typescript
// src/routes/withdrawal.ts
import express from 'express';
import { zcashSDK } from '../services/zcash-withdrawal';
import { validateAddressDetailed } from 'exchange-shielded-sdk';

const router = express.Router();

router.post('/withdraw/zcash', async (req, res) => {
  const { userId, destinationAddress, amount } = req.body;

  try {
    // 1. Validate user session (your authentication)
    const user = await authenticateUser(req);
    if (!user || user.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Validate destination address
    const addressValidation = validateAddressDetailed(destinationAddress);
    if (!addressValidation.valid) {
      return res.status(400).json({
        error: 'Invalid address',
        details: addressValidation.error
      });
    }

    // 3. Check user balance (your database)
    const userBalance = await getUserZcashBalance(userId);
    const estimatedFee = await zcashSDK.estimateWithdrawalFee(amount, destinationAddress);
    const totalRequired = amount + estimatedFee.feeZec;

    if (userBalance < totalRequired) {
      return res.status(400).json({
        error: 'Insufficient balance',
        required: totalRequired,
        available: userBalance
      });
    }

    // 4. Pre-check rate limits
    const rateLimitCheck = zcashSDK.checkRateLimit(userId, amount);
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        reason: rateLimitCheck.reason,
        retryAfter: rateLimitCheck.retryAfterMs
      });
    }

    // 5. Get hot wallet address (your configuration)
    const hotWalletAddress = await getHotWalletAddress();

    // 6. Process withdrawal
    const result = await zcashSDK.processWithdrawal({
      userId,
      fromAddress: hotWalletAddress,
      toAddress: destinationAddress,
      amount,
      requestId: `wd-${Date.now()}`
    });

    if (result.success) {
      // 7. Update user balance in database
      await deductUserBalance(userId, amount + (result.fee || 0));

      // 8. Record withdrawal in database
      await recordWithdrawal({
        userId,
        txId: result.transactionId,
        amount,
        fee: result.fee,
        destination: destinationAddress,
        status: 'completed'
      });

      return res.json({
        success: true,
        transactionId: result.transactionId,
        amount,
        fee: result.fee
      });
    } else {
      return res.status(500).json({
        error: 'Withdrawal failed',
        details: result.error,
        errorCode: result.errorCode
      });
    }
  } catch (error) {
    console.error('Withdrawal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

### Step 3: Implement Balance Checking

```typescript
// src/services/balance-check.ts
import { ZcashRpcClient, createRpcClient } from 'exchange-shielded-sdk';

const rpcClient = createRpcClient(
  process.env.ZCASH_RPC_HOST || '127.0.0.1',
  parseInt(process.env.ZCASH_RPC_PORT || '8232'),
  {
    username: process.env.ZCASH_RPC_USER || '',
    password: process.env.ZCASH_RPC_PASSWORD || ''
  }
);

export async function getHotWalletBalance(): Promise<number> {
  // Get total balance across all addresses
  const balance = await rpcClient.z_gettotalbalance(10);
  return parseFloat(balance.private);
}

export async function getAddressBalance(address: string): Promise<number> {
  return rpcClient.z_getbalance(address, 10);
}

export async function listUnspentNotes(minAmount: number = 0): Promise<any[]> {
  const notes = await rpcClient.z_listunspent(10);
  return notes.filter(note => note.amount >= minAmount);
}
```

### Step 4: Implement Fee Estimation Endpoint

```typescript
// src/routes/fees.ts
router.get('/withdraw/zcash/fee-estimate', async (req, res) => {
  const { amount, destinationAddress } = req.query;

  try {
    const estimate = await zcashSDK.estimateWithdrawalFee(
      parseFloat(amount as string),
      destinationAddress as string
    );

    return res.json({
      feeZec: estimate.feeZec,
      feeZatoshis: estimate.feeZatoshis,
      logicalActions: estimate.logicalActions,
      isApproximate: estimate.isApproximate
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
```

### Step 5: Implement Status Checking

```typescript
// src/routes/status.ts
router.get('/withdraw/zcash/status/:txId', async (req, res) => {
  const { txId } = req.params;

  try {
    const status = await zcashSDK.getWithdrawalStatus(txId);

    return res.json({
      transactionId: txId,
      status: status.status,
      confirmations: status.confirmations,
      error: status.error
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get status' });
  }
});
```

### Step 6: Set Up Compliance Reporting

```typescript
// src/services/compliance.ts
router.get('/admin/compliance/report', async (req, res) => {
  // Admin authentication required
  const { startDate, endDate } = req.query;

  const report = await zcashSDK.getComplianceReport({
    start: new Date(startDate as string),
    end: new Date(endDate as string)
  });

  return res.json({
    generatedAt: report.generatedAt,
    period: {
      start: report.periodStart,
      end: report.periodEnd
    },
    summary: report.summary,
    integrityCheck: report.integrityCheck
  });
});

router.get('/admin/compliance/viewing-keys', async (req, res) => {
  // Admin authentication required
  const bundle = await zcashSDK.exportViewingKeys();

  return res.json({
    bundleId: bundle.bundleId,
    exportedAt: bundle.exportedAt,
    keyCount: bundle.keys.length,
    bundleHash: bundle.bundleHash
  });
});
```

---

## Production Deployment

### Production Checklist

#### Security

- [ ] RPC credentials stored in secure secrets manager (not environment variables)
- [ ] HTTPS enabled for all external communication
- [ ] Firewall rules restrict RPC access to localhost only
- [ ] Rate limiting configured appropriately for expected volume
- [ ] Audit logging enabled and logs shipped to secure storage
- [ ] Key manager auto-clear enabled for inactive keys
- [ ] Input sanitization enabled (default)

#### Infrastructure

- [ ] zcashd running on dedicated server or container
- [ ] Blockchain data on SSD storage for performance
- [ ] Monitoring alerts for node sync status
- [ ] Backup strategy for wallet.dat and keys
- [ ] Load balancer with health checks
- [ ] Database replication for withdrawal records

#### Operational

- [ ] Withdrawal approval workflow for large amounts
- [ ] Hot wallet balance alerts (low balance warning)
- [ ] Cold wallet procedure for fund replenishment
- [ ] Incident response procedure documented
- [ ] Compliance team access to reporting endpoints

### Environment Configuration

```bash
# .env.production
NODE_ENV=production

# Zcash Node
ZCASH_RPC_HOST=127.0.0.1
ZCASH_RPC_PORT=8232
ZCASH_RPC_USER=<from secrets manager>
ZCASH_RPC_PASSWORD=<from secrets manager>

# SDK Configuration
SDK_MIN_CONFIRMATIONS=10
SDK_PRIVACY_POLICY=FullPrivacy
SDK_ENABLE_COMPLIANCE=true
SDK_ENABLE_AUDIT_LOGGING=true

# Rate Limits (conservative production values)
RATE_LIMIT_WITHDRAWALS_PER_HOUR=5
RATE_LIMIT_WITHDRAWALS_PER_DAY=20
RATE_LIMIT_MAX_AMOUNT_PER_WITHDRAWAL=50
RATE_LIMIT_MAX_AMOUNT_PER_DAY=200
RATE_LIMIT_COOLDOWN_MS=120000

# Hot Wallet
HOT_WALLET_ADDRESS=zs1...
HOT_WALLET_MIN_BALANCE=100
HOT_WALLET_ALERT_THRESHOLD=50
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

# Non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  exchange-api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    secrets:
      - zcash_rpc_credentials
    depends_on:
      - zcashd
    restart: unless-stopped

  zcashd:
    image: electriccoinco/zcashd:latest
    volumes:
      - zcash-data:/home/zcash/.zcash
      - ./zcash.conf:/home/zcash/.zcash/zcash.conf:ro
    restart: unless-stopped

volumes:
  zcash-data:

secrets:
  zcash_rpc_credentials:
    external: true
```

### Monitoring

```typescript
// src/monitoring/health.ts
import { zcashSDK } from '../services/zcash-withdrawal';

export async function healthCheck(): Promise<HealthStatus> {
  const checks = {
    zcashNode: false,
    hotWalletBalance: 0,
    auditLogIntegrity: false
  };

  try {
    // Check node connectivity
    const balance = await getHotWalletBalance();
    checks.zcashNode = true;
    checks.hotWalletBalance = balance;

    // Check audit log integrity
    const auditLogger = zcashSDK.getAuditLogger();
    const integrity = auditLogger.verifyIntegrity();
    checks.auditLogIntegrity = integrity.valid;

    return {
      healthy: checks.zcashNode && checks.auditLogIntegrity,
      checks,
      timestamp: new Date()
    };
  } catch (error) {
    return {
      healthy: false,
      checks,
      error: error.message,
      timestamp: new Date()
    };
  }
}
```

### Alerting

```typescript
// src/monitoring/alerts.ts
export async function checkAlerts(): Promise<void> {
  // Low balance alert
  const balance = await getHotWalletBalance();
  if (balance < HOT_WALLET_ALERT_THRESHOLD) {
    await sendAlert({
      severity: 'warning',
      message: `Hot wallet balance low: ${balance} ZEC`,
      action: 'Replenish from cold wallet'
    });
  }

  // Suspicious activity check
  const complianceManager = zcashSDK.getComplianceManager();
  const stats = complianceManager.getStatistics();
  if (stats.totalFlagsActive > 0) {
    await sendAlert({
      severity: 'info',
      message: `${stats.totalFlagsActive} suspicious activity flags pending review`,
      action: 'Review in compliance dashboard'
    });
  }

  // Audit log integrity
  const auditLogger = zcashSDK.getAuditLogger();
  const integrity = auditLogger.verifyIntegrity();
  if (!integrity.valid) {
    await sendAlert({
      severity: 'critical',
      message: 'Audit log integrity check failed!',
      action: 'Investigate immediately'
    });
  }
}
```

---

## Troubleshooting

### Common Issues

#### "Connection refused" to zcashd

```bash
# Check if zcashd is running
ps aux | grep zcashd

# Check RPC port is open
netstat -tlnp | grep 8232

# Verify RPC configuration
cat ~/.zcash/zcash.conf | grep rpc
```

#### "Insufficient funds" error

```typescript
// Check available balance with confirmations
const notes = await rpcClient.z_listunspent(10);
const availableBalance = notes
  .filter(n => n.spendable)
  .reduce((sum, n) => sum + n.amount, 0);

console.log('Available (10+ confirmations):', availableBalance);
```

#### Rate limit issues

```typescript
// Check current limits for user
const remaining = rateLimiter.getRemainingLimit(userId);
console.log('Remaining limits:', remaining);

// Reset user limits (admin action)
rateLimiter.resetUser(userId);
```

#### Transaction stuck in pending

```typescript
// Check operation status
const operations = await rpcClient.z_getoperationstatus();
console.log('Pending operations:', operations);

// Check mempool
// zcash-cli getmempoolinfo
```

### Debug Mode

```typescript
// Enable verbose logging
const sdk = createExchangeSDK({
  ...config,
  enableAuditLogging: true
});

// Get audit events for debugging
const logger = sdk.getAuditLogger();
const recentEvents = logger.getEvents({
  startDate: new Date(Date.now() - 3600000), // Last hour
  limit: 100
});

console.log('Recent audit events:', recentEvents);
```

### Support Resources

- [Zcash Documentation](https://zcash.readthedocs.io/)
- [ZIP 317 Fee Specification](https://zips.z.cash/zip-0317)
- [zcashd RPC Reference](https://zcash.github.io/rpc/)
- [SDK API Reference](./API.md)
