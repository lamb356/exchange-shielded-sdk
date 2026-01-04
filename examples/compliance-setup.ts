/**
 * Compliance Setup Example
 *
 * This example demonstrates how to:
 * - Configure audit logger
 * - Set up velocity checks
 * - Export viewing keys
 * - Generate compliance report
 *
 * Run with: npx ts-node examples/compliance-setup.ts
 */

import {
  AuditLogger,
  AuditEventType,
  AuditSeverity,
  createAuditLogger,
  getDefaultSeverity,
  ComplianceManager,
  createComplianceManager,
  redactSensitiveData,
} from '../src/index.js';

async function main(): Promise<void> {
  console.log('=== Exchange Shielded SDK - Compliance Setup Example ===\n');

  // =========================================================================
  // Part 1: Audit Logger Setup
  // =========================================================================
  console.log('Part 1: Setting up Audit Logger\n');

  // Create audit logger with custom configuration
  const auditLogger = createAuditLogger({
    maxEvents: 10000,
    minSeverity: AuditSeverity.INFO,
    autoRedact: true,
    verifyChainOnLog: true,
    onEvent: (event) => {
      // Custom handler - could ship to external logging system
      console.log(`  [Audit] ${event.eventType}: ${event.userId || 'system'}`);
    },
  });

  console.log('Audit logger created with:');
  console.log('  - Max events: 10,000');
  console.log('  - Min severity: INFO');
  console.log('  - Auto-redact: enabled');
  console.log('  - Chain verification: enabled\n');

  // Log some example events
  console.log('Logging example events...\n');

  // Withdrawal requested
  auditLogger.log({
    eventType: AuditEventType.WITHDRAWAL_REQUESTED,
    severity: AuditSeverity.INFO,
    userId: 'user-123',
    amount: 10.5,
    destinationAddress: 'zs1destination123456789abcdef...',
    metadata: {
      requestId: 'req-001',
      sourceIP: '192.168.1.100',
    },
  });

  // Withdrawal approved
  auditLogger.log({
    eventType: AuditEventType.WITHDRAWAL_APPROVED,
    severity: AuditSeverity.INFO,
    userId: 'user-123',
    amount: 10.5,
    metadata: {
      requestId: 'req-001',
      checks: { rateLimit: 'passed', velocity: 'passed' },
    },
  });

  // Withdrawal completed
  auditLogger.log({
    eventType: AuditEventType.WITHDRAWAL_COMPLETED,
    severity: AuditSeverity.INFO,
    userId: 'user-123',
    transactionId: 'txid123456789abcdef...',
    amount: 10.5,
    destinationAddress: 'zs1destination123456789abcdef...',
    metadata: {
      requestId: 'req-001',
      fee: 0.0001,
    },
  });

  // Rate limit hit
  auditLogger.log({
    eventType: AuditEventType.RATE_LIMIT_HIT,
    severity: AuditSeverity.WARNING,
    userId: 'user-456',
    amount: 50,
    metadata: {
      reason: 'Hourly limit exceeded',
      currentUsage: 11,
      limit: 10,
    },
  });

  // Suspicious activity
  auditLogger.log({
    eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
    severity: AuditSeverity.CRITICAL,
    userId: 'user-789',
    metadata: {
      reason: 'Multiple failed withdrawals',
      failedAttempts: 5,
      timeWindow: '1 hour',
    },
  });

  console.log(`\nTotal events logged: ${auditLogger.getEventCount()}`);
  console.log(`Last event hash: ${auditLogger.getLastHash().substring(0, 16)}...\n`);

  // Verify integrity
  console.log('Verifying audit log integrity...');
  const integrity = auditLogger.verifyIntegrity();
  console.log(`  Valid: ${integrity.valid}`);
  if (!integrity.valid && integrity.brokenAt !== undefined) {
    console.log(`  Broken at event: ${integrity.brokenAt}`);
  }
  console.log('');

  // =========================================================================
  // Part 2: Compliance Manager Setup
  // =========================================================================
  console.log('Part 2: Setting up Compliance Manager\n');

  const compliance = createComplianceManager({
    velocityThresholds: {
      maxTransactionsPerHour: 10,
      maxTransactionsPerDay: 50,
      maxAmountPerHour: 100,
      maxAmountPerDay: 1000,
    },
    viewingKeyValidityMs: 24 * 60 * 60 * 1000, // 24 hours
    auditLogger: auditLogger,
  });

  console.log('Compliance manager created with velocity thresholds:');
  console.log('  - Max transactions/hour: 10');
  console.log('  - Max transactions/day: 50');
  console.log('  - Max amount/hour: 100 ZEC');
  console.log('  - Max amount/day: 1000 ZEC\n');

  // =========================================================================
  // Part 3: Velocity Checks
  // =========================================================================
  console.log('Part 3: Demonstrating Velocity Checks\n');

  // Simulate some transactions
  const testUsers = ['alice', 'bob', 'charlie'];
  const testAmounts = [10, 25, 50, 15, 30];

  console.log('Simulating transactions...\n');

  for (const userId of testUsers) {
    for (const amount of testAmounts) {
      // Check velocity before transaction
      const check = compliance.checkVelocity(userId, amount);

      if (check.passed) {
        // Record the transaction
        compliance.recordTransaction(userId, amount);
        console.log(`  ${userId}: ${amount} ZEC - APPROVED (risk: ${check.riskScore})`);
      } else {
        console.log(`  ${userId}: ${amount} ZEC - DENIED (${check.reason})`);
      }
    }
    console.log('');
  }

  // Check velocity status for a user
  const velocityCheck = compliance.checkVelocity('alice', 20);
  console.log('Current velocity for "alice":');
  console.log(`  Transactions (hour): ${velocityCheck.velocity.lastHour}`);
  console.log(`  Transactions (day): ${velocityCheck.velocity.last24Hours}`);
  console.log(`  Amount (hour): ${velocityCheck.velocity.amountLastHour} ZEC`);
  console.log(`  Amount (day): ${velocityCheck.velocity.amountLast24Hours} ZEC`);
  console.log(`  Risk score: ${velocityCheck.riskScore}/100\n`);

  // =========================================================================
  // Part 4: Suspicious Activity Flagging
  // =========================================================================
  console.log('Part 4: Suspicious Activity Flagging\n');

  // Flag some suspicious activities
  const flag1 = compliance.flagSuspiciousActivity('dave', 'Multiple withdrawals to same address', {
    targetAddress: 'zs1suspicious...',
    count: 5,
  });

  const flag2 = compliance.flagSuspiciousActivity(
    'eve',
    'Withdrawal amount close to limit',
    {
      amount: 99.5,
      limit: 100,
    }
  );

  const flag3 = compliance.flagSuspiciousActivity('frank', 'Unusual activity pattern detected', {
    pattern: 'rapid-fire-withdrawals',
    timeWindow: '5 minutes',
  });

  console.log('Created suspicious activity flags:');
  console.log(`  1. ${flag1.id}: ${flag1.reason} (severity: ${flag1.severity})`);
  console.log(`  2. ${flag2.id}: ${flag2.reason} (severity: ${flag2.severity})`);
  console.log(`  3. ${flag3.id}: ${flag3.reason} (severity: ${flag3.severity})\n`);

  // Get flags for review
  const daveFlags = compliance.getUserFlags('dave');
  console.log(`Pending flags for "dave": ${daveFlags.length}`);

  // Review a flag
  const reviewed = compliance.reviewFlag(flag1.id, 'Investigated - false positive, approved by admin');
  console.log(`Flag ${flag1.id} reviewed: ${reviewed}\n`);

  // =========================================================================
  // Part 5: Viewing Key Export
  // =========================================================================
  console.log('Part 5: Viewing Key Export\n');

  // Register some viewing keys (simulated)
  compliance.registerViewingKey(
    'hot-wallet-1',
    'vk1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
    'sapling'
  );

  compliance.registerViewingKey(
    'hot-wallet-2',
    'vk0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedc',
    'sapling'
  );

  console.log('Registered viewing keys: hot-wallet-1, hot-wallet-2\n');

  // Export viewing keys for auditor
  try {
    const bundle = compliance.exportViewingKeys('quarterly_audit_2024_Q1');

    console.log('Viewing key bundle exported:');
    console.log(`  Bundle ID: ${bundle.bundleId}`);
    console.log(`  Exported at: ${bundle.exportedAt}`);
    console.log(`  Key count: ${bundle.keys.length}`);
    console.log(`  Bundle hash: ${bundle.bundleHash.substring(0, 16)}...`);

    for (const key of bundle.keys) {
      console.log(`\n  Key "${key.keyId}":`);
      console.log(`    Type: ${key.keyType}`);
      console.log(`    Checksum: ${key.checksum}`);
      console.log(`    Expires: ${key.expiresAt}`);
    }
  } catch (error) {
    console.log('Note: Viewing key export requires registered keys');
  }
  console.log('');

  // =========================================================================
  // Part 6: Compliance Report Generation
  // =========================================================================
  console.log('Part 6: Generating Compliance Report\n');

  // Generate report for the last 30 days
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  const report = compliance.generateComplianceReport({ start: startDate, end: endDate });

  console.log('Compliance Report Summary:');
  console.log(`  Period: ${report.periodStart.toISOString()} to ${report.periodEnd.toISOString()}`);
  console.log(`  Generated: ${report.generatedAt.toISOString()}`);
  console.log('');
  console.log('  Statistics:');
  console.log(`    Total events: ${report.summary.totalEvents}`);
  console.log(`    Completed withdrawals: ${report.summary.withdrawalCount}`);
  console.log(`    Total withdrawn: ${report.summary.totalWithdrawnAmount} ZEC`);
  console.log(`    Failed withdrawals: ${report.summary.failedWithdrawals}`);
  console.log(`    Rate limit hits: ${report.summary.rateLimitHits}`);
  console.log(`    Suspicious activities: ${report.summary.suspiciousActivityCount}`);
  console.log('');
  console.log('  Integrity Check:');
  console.log(`    Valid: ${report.integrityCheck.valid}`);
  console.log(`    Chain verified: ${report.integrityCheck.chainVerified}`);
  console.log(`    First hash: ${report.integrityCheck.firstEventHash.substring(0, 16)}...`);
  console.log(`    Last hash: ${report.integrityCheck.lastEventHash.substring(0, 16)}...`);
  console.log('');

  // Display events by type
  console.log('  Events by Type:');
  for (const [type, count] of Object.entries(report.eventsByType)) {
    if (count > 0) {
      console.log(`    ${type}: ${count}`);
    }
  }
  console.log('');

  // Display events by severity
  console.log('  Events by Severity:');
  for (const [severity, count] of Object.entries(report.eventsBySeverity)) {
    if (count > 0) {
      console.log(`    ${severity}: ${count}`);
    }
  }
  console.log('');

  // =========================================================================
  // Part 7: Data Redaction for Logging
  // =========================================================================
  console.log('Part 7: Demonstrating Data Redaction\n');

  const sensitiveData = {
    userId: 'user-123',
    spendingKey: 'sk1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
    address: 'zs1sensitive123456789abcdefghijklmnopqrstuvwxyz',
    amount: 100.5,
    password: 'supersecret123',
    apiKey: 'api-key-12345',
    nested: {
      privateKey: 'private-key-data',
      publicData: 'this is public',
    },
  };

  console.log('Original data:');
  console.log(JSON.stringify(sensitiveData, null, 2));
  console.log('');

  const redacted = redactSensitiveData(sensitiveData);
  console.log('Redacted data (safe for logging):');
  console.log(JSON.stringify(redacted, null, 2));
  console.log('');

  // =========================================================================
  // Part 8: Statistics Summary
  // =========================================================================
  console.log('Part 8: System Statistics\n');

  const stats = compliance.getStatistics();
  console.log('Current compliance statistics:');
  console.log(`  Transactions tracked: ${stats.totalTransactionsTracked}`);
  console.log(`  Active flags: ${stats.totalFlagsActive}`);
  console.log(`  Reviewed flags: ${stats.totalFlagsReviewed}`);
  console.log(`  Registered viewing keys: ${stats.registeredViewingKeys}`);
  console.log('');

  console.log('=== Compliance Setup Complete ===');
}

// Run the example
main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
