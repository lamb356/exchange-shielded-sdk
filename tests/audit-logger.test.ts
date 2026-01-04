/**
 * Audit Logger Tests
 *
 * Tests for the AuditLogger and ComplianceManager classes.
 */

import {
  AuditLogger,
  AuditEventType,
  AuditSeverity,
  createAuditLogger,
  getDefaultSeverity,
  ComplianceManager,
  createComplianceManager,
} from '../src/compliance/index.js';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  describe('log', () => {
    it('should log an event with required fields', () => {
      const event = logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
      });

      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.eventType).toBe(AuditEventType.WITHDRAWAL_REQUESTED);
      expect(event.severity).toBe(AuditSeverity.INFO);
      expect(event.hash).toBeDefined();
      expect(event.previousHash).toBeDefined();
    });

    it('should log an event with optional fields', () => {
      const event = logger.log({
        eventType: AuditEventType.WITHDRAWAL_COMPLETED,
        severity: AuditSeverity.INFO,
        userId: 'user-123',
        transactionId: 'tx-abc',
        amount: 10.5,
        destinationAddress: 'zs1abc...',
        metadata: { note: 'test' },
      });

      expect(event.userId).toBe('user-123');
      expect(event.transactionId).toBe('tx-abc');
      expect(event.amount).toBe(10.5);
      expect(event.metadata).toEqual({ note: 'test' });
    });

    it('should auto-redact shielded addresses', () => {
      const addr = 'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';
      const event = logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
        destinationAddress: addr,
      });

      expect(event.destinationAddress).toContain('...');
      expect(event.destinationAddress?.length).toBeLessThan(addr.length);
    });

    it('should create unique event IDs', () => {
      const event1 = logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
      });

      const event2 = logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
      });

      expect(event1.id).not.toBe(event2.id);
    });

    it('should chain events with previous hash', () => {
      const event1 = logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
      });

      const event2 = logger.log({
        eventType: AuditEventType.WITHDRAWAL_COMPLETED,
        severity: AuditSeverity.INFO,
      });

      expect(event2.previousHash).toBe(event1.hash);
    });

    it('should respect minimum severity filter', () => {
      const filteredLogger = new AuditLogger({
        minSeverity: AuditSeverity.WARNING,
      });

      // DEBUG and INFO should not be logged
      const debugEvent = filteredLogger.log({
        eventType: AuditEventType.COMPLIANCE_CHECK,
        severity: AuditSeverity.DEBUG,
      });

      const infoEvent = filteredLogger.log({
        eventType: AuditEventType.COMPLIANCE_CHECK,
        severity: AuditSeverity.INFO,
      });

      // WARNING should be logged
      const warnEvent = filteredLogger.log({
        eventType: AuditEventType.RATE_LIMIT_HIT,
        severity: AuditSeverity.WARNING,
      });

      expect(filteredLogger.getEventCount()).toBe(1);
      expect(debugEvent.id).toBe('');
      expect(infoEvent.id).toBe('');
      expect(warnEvent.id).toBeDefined();
    });

    it('should enforce max events limit', () => {
      const limitedLogger = new AuditLogger({ maxEvents: 5 });

      for (let i = 0; i < 10; i++) {
        limitedLogger.log({
          eventType: AuditEventType.WITHDRAWAL_REQUESTED,
          severity: AuditSeverity.INFO,
          metadata: { index: i },
        });
      }

      expect(limitedLogger.getEventCount()).toBe(5);
    });

    it('should call onEvent handler', () => {
      const events: unknown[] = [];
      const handlerLogger = new AuditLogger({
        onEvent: (event) => events.push(event),
      });

      handlerLogger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
      });

      expect(events.length).toBe(1);
    });
  });

  describe('getEvents', () => {
    beforeEach(() => {
      // Populate with test events
      logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
        userId: 'user-1',
        amount: 10,
      });

      logger.log({
        eventType: AuditEventType.WITHDRAWAL_COMPLETED,
        severity: AuditSeverity.INFO,
        userId: 'user-1',
        amount: 10,
      });

      logger.log({
        eventType: AuditEventType.RATE_LIMIT_HIT,
        severity: AuditSeverity.WARNING,
        userId: 'user-2',
      });

      logger.log({
        eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
        severity: AuditSeverity.CRITICAL,
        userId: 'user-3',
      });
    });

    it('should return all events when no filter', () => {
      const events = logger.getEvents();

      expect(events.length).toBe(4);
    });

    it('should filter by event type', () => {
      const events = logger.getEvents({
        eventTypes: [AuditEventType.WITHDRAWAL_REQUESTED],
      });

      expect(events.length).toBe(1);
      expect(events[0]?.eventType).toBe(AuditEventType.WITHDRAWAL_REQUESTED);
    });

    it('should filter by multiple event types', () => {
      const events = logger.getEvents({
        eventTypes: [
          AuditEventType.WITHDRAWAL_REQUESTED,
          AuditEventType.WITHDRAWAL_COMPLETED,
        ],
      });

      expect(events.length).toBe(2);
    });

    it('should filter by minimum severity', () => {
      const events = logger.getEvents({
        minSeverity: AuditSeverity.WARNING,
      });

      expect(events.length).toBe(2); // WARNING and CRITICAL
    });

    it('should filter by user ID', () => {
      const events = logger.getEvents({
        userId: 'user-1',
      });

      expect(events.length).toBe(2);
    });

    it('should support pagination with limit', () => {
      const events = logger.getEvents({ limit: 2 });

      expect(events.length).toBe(2);
    });

    it('should support pagination with offset', () => {
      const events = logger.getEvents({ offset: 2, limit: 2 });

      expect(events.length).toBe(2);
    });

    it('should filter by date range', () => {
      const start = new Date(Date.now() - 1000);
      const end = new Date(Date.now() + 1000);

      const events = logger.getEvents({ startDate: start, endDate: end });

      expect(events.length).toBe(4);
    });
  });

  describe('exportForCompliance', () => {
    beforeEach(() => {
      logger.log({
        eventType: AuditEventType.WITHDRAWAL_COMPLETED,
        severity: AuditSeverity.INFO,
        amount: 10,
      });

      logger.log({
        eventType: AuditEventType.WITHDRAWAL_COMPLETED,
        severity: AuditSeverity.INFO,
        amount: 20,
      });

      logger.log({
        eventType: AuditEventType.WITHDRAWAL_FAILED,
        severity: AuditSeverity.ERROR,
      });

      logger.log({
        eventType: AuditEventType.RATE_LIMIT_HIT,
        severity: AuditSeverity.WARNING,
      });

      logger.log({
        eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
        severity: AuditSeverity.CRITICAL,
      });
    });

    it('should generate a compliance report', () => {
      const start = new Date(Date.now() - 10000);
      const end = new Date(Date.now() + 10000);

      const report = logger.exportForCompliance(start, end);

      expect(report.generatedAt).toBeInstanceOf(Date);
      expect(report.periodStart).toEqual(start);
      expect(report.periodEnd).toEqual(end);
    });

    it('should include summary statistics', () => {
      const report = logger.exportForCompliance(
        new Date(Date.now() - 10000),
        new Date(Date.now() + 10000)
      );

      expect(report.summary.totalEvents).toBe(5);
      expect(report.summary.withdrawalCount).toBe(2);
      expect(report.summary.totalWithdrawnAmount).toBe(30);
      expect(report.summary.failedWithdrawals).toBe(1);
      expect(report.summary.rateLimitHits).toBe(1);
      expect(report.summary.suspiciousActivityCount).toBe(1);
    });

    it('should include events by type', () => {
      const report = logger.exportForCompliance(
        new Date(Date.now() - 10000),
        new Date(Date.now() + 10000)
      );

      expect(report.eventsByType[AuditEventType.WITHDRAWAL_COMPLETED]).toBe(2);
      expect(report.eventsByType[AuditEventType.WITHDRAWAL_FAILED]).toBe(1);
    });

    it('should include events by severity', () => {
      const report = logger.exportForCompliance(
        new Date(Date.now() - 10000),
        new Date(Date.now() + 10000)
      );

      expect(report.eventsBySeverity[AuditSeverity.INFO]).toBe(2);
      expect(report.eventsBySeverity[AuditSeverity.WARNING]).toBe(1);
      expect(report.eventsBySeverity[AuditSeverity.ERROR]).toBe(1);
      expect(report.eventsBySeverity[AuditSeverity.CRITICAL]).toBe(1);
    });

    it('should include integrity check', () => {
      const report = logger.exportForCompliance(
        new Date(Date.now() - 10000),
        new Date(Date.now() + 10000)
      );

      expect(report.integrityCheck.valid).toBe(true);
      expect(report.integrityCheck.chainVerified).toBe(true);
      expect(report.integrityCheck.firstEventHash).toBeDefined();
      expect(report.integrityCheck.lastEventHash).toBeDefined();
    });
  });

  describe('verifyIntegrity', () => {
    it('should verify empty log', () => {
      const result = logger.verifyIntegrity();

      expect(result.valid).toBe(true);
    });

    it('should verify valid chain', () => {
      logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
      });

      logger.log({
        eventType: AuditEventType.WITHDRAWAL_COMPLETED,
        severity: AuditSeverity.INFO,
      });

      const result = logger.verifyIntegrity();

      expect(result.valid).toBe(true);
    });
  });

  describe('utility functions', () => {
    it('getEventCount should return count', () => {
      expect(logger.getEventCount()).toBe(0);

      logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
      });

      expect(logger.getEventCount()).toBe(1);
    });

    it('getLastHash should return last hash', () => {
      const initialHash = logger.getLastHash();
      expect(initialHash).toBeDefined();

      logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
      });

      expect(logger.getLastHash()).not.toBe(initialHash);
    });

    it('clear should remove all events', () => {
      logger.log({
        eventType: AuditEventType.WITHDRAWAL_REQUESTED,
        severity: AuditSeverity.INFO,
      });

      logger.clear();

      expect(logger.getEventCount()).toBe(0);
    });
  });

  describe('getDefaultSeverity', () => {
    it('should return INFO for completed events', () => {
      expect(getDefaultSeverity(AuditEventType.WITHDRAWAL_COMPLETED)).toBe(
        AuditSeverity.INFO
      );
    });

    it('should return WARNING for rate limit events', () => {
      expect(getDefaultSeverity(AuditEventType.RATE_LIMIT_HIT)).toBe(
        AuditSeverity.WARNING
      );
    });

    it('should return ERROR for failed events', () => {
      expect(getDefaultSeverity(AuditEventType.WITHDRAWAL_FAILED)).toBe(
        AuditSeverity.ERROR
      );
    });

    it('should return CRITICAL for security events', () => {
      expect(getDefaultSeverity(AuditEventType.SUSPICIOUS_ACTIVITY)).toBe(
        AuditSeverity.CRITICAL
      );
    });
  });

  describe('createAuditLogger factory', () => {
    it('should create logger with defaults', () => {
      const logger = createAuditLogger();

      expect(logger).toBeInstanceOf(AuditLogger);
    });

    it('should create logger with custom config', () => {
      const logger = createAuditLogger({ maxEvents: 100 });

      expect(logger).toBeInstanceOf(AuditLogger);
    });
  });
});

describe('ComplianceManager', () => {
  let manager: ComplianceManager;

  beforeEach(() => {
    manager = new ComplianceManager();
  });

  describe('checkVelocity', () => {
    it('should pass for first transaction', () => {
      const result = manager.checkVelocity('user-1', 10);

      expect(result.passed).toBe(true);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
    });

    it('should track velocity over multiple transactions', () => {
      manager.recordTransaction('user-1', 50);
      manager.recordTransaction('user-1', 50);

      const result = manager.checkVelocity('user-1', 50);

      expect(result.velocity.last24Hours).toBe(2);
      expect(result.velocity.amountLast24Hours).toBe(100);
    });

    it('should fail when velocity threshold exceeded', () => {
      const strictManager = new ComplianceManager({
        velocityThresholds: {
          maxTransactionsPerHour: 2,
          maxTransactionsPerDay: 10,
          maxAmountPerHour: 100,
          maxAmountPerDay: 1000,
        },
      });

      strictManager.recordTransaction('user-1', 10);
      strictManager.recordTransaction('user-1', 10);

      const result = strictManager.checkVelocity('user-1', 10);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('Hourly transaction limit');
    });

    it('should calculate risk score', () => {
      // Make some transactions to increase risk
      for (let i = 0; i < 5; i++) {
        manager.recordTransaction('user-1', 50);
      }

      const result = manager.checkVelocity('user-1', 50);

      expect(result.riskScore).toBeGreaterThan(0);
    });
  });

  describe('flagSuspiciousActivity', () => {
    it('should create a flag', () => {
      const flag = manager.flagSuspiciousActivity('user-1', 'Unusual pattern');

      expect(flag.id).toBeDefined();
      expect(flag.userId).toBe('user-1');
      expect(flag.reason).toBe('Unusual pattern');
      expect(flag.reviewed).toBe(false);
    });

    it('should determine severity from reason', () => {
      const lowFlag = manager.flagSuspiciousActivity('user-1', 'Minor issue');
      expect(lowFlag.severity).toBe('low');

      const highFlag = manager.flagSuspiciousActivity(
        'user-1',
        'Multiple failed attempts'
      );
      expect(highFlag.severity).toBe('high');

      const criticalFlag = manager.flagSuspiciousActivity(
        'user-1',
        'Possible fraud detected'
      );
      expect(criticalFlag.severity).toBe('critical');
    });

    it('should store flags per user', () => {
      manager.flagSuspiciousActivity('user-1', 'Issue 1');
      manager.flagSuspiciousActivity('user-1', 'Issue 2');
      manager.flagSuspiciousActivity('user-2', 'Issue 3');

      const user1Flags = manager.getUserFlags('user-1');
      const user2Flags = manager.getUserFlags('user-2');

      expect(user1Flags.length).toBe(2);
      expect(user2Flags.length).toBe(1);
    });
  });

  describe('reviewFlag', () => {
    it('should mark flag as reviewed', () => {
      const flag = manager.flagSuspiciousActivity('user-1', 'Test issue');

      const result = manager.reviewFlag(flag.id, 'Investigated and cleared');

      expect(result).toBe(true);

      const flags = manager.getUserFlags('user-1', true);
      const reviewedFlag = flags.find((f) => f.id === flag.id);

      expect(reviewedFlag?.reviewed).toBe(true);
      expect(reviewedFlag?.reviewNotes).toBe('Investigated and cleared');
    });

    it('should return false for unknown flag', () => {
      const result = manager.reviewFlag('unknown-id', 'Notes');

      expect(result).toBe(false);
    });

    it('should filter out reviewed flags by default', () => {
      const flag = manager.flagSuspiciousActivity('user-1', 'Test issue');
      manager.reviewFlag(flag.id, 'Cleared');

      const unreviewed = manager.getUserFlags('user-1', false);
      const all = manager.getUserFlags('user-1', true);

      expect(unreviewed.length).toBe(0);
      expect(all.length).toBe(1);
    });
  });

  describe('viewing key management', () => {
    it('should register and export viewing key', () => {
      manager.registerViewingKey('key-1', 'abcd1234', 'sapling');

      const exported = manager.exportViewingKey('key-1', 'audit');

      expect(exported.keyId).toBe('key-1');
      expect(exported.viewingKey).toBe('abcd1234');
      expect(exported.keyType).toBe('sapling');
      expect(exported.purpose).toBe('audit');
      expect(exported.checksum).toBeDefined();
    });

    it('should throw for unknown key', () => {
      expect(() => {
        manager.exportViewingKey('unknown-key', 'audit');
      }).toThrow();
    });

    it('should export viewing key bundle', () => {
      manager.registerViewingKey('key-1', 'abcd1234', 'sapling');
      manager.registerViewingKey('key-2', 'efgh5678', 'orchard');

      const bundle = manager.exportViewingKeys('compliance_export');

      expect(bundle.bundleId).toBeDefined();
      expect(bundle.keys.length).toBe(2);
      expect(bundle.bundleHash).toBeDefined();
    });
  });

  describe('generateComplianceReport', () => {
    it('should generate a report', () => {
      const period = {
        start: new Date(Date.now() - 86400000),
        end: new Date(),
      };

      const report = manager.generateComplianceReport(period);

      expect(report.generatedAt).toBeInstanceOf(Date);
      expect(report.summary).toBeDefined();
    });
  });

  describe('getStatistics', () => {
    it('should return statistics', () => {
      manager.recordTransaction('user-1', 100);
      manager.flagSuspiciousActivity('user-1', 'Test');
      manager.registerViewingKey('key-1', 'abcd', 'sapling');

      const stats = manager.getStatistics();

      expect(stats.totalTransactionsTracked).toBe(1);
      expect(stats.totalFlagsActive).toBe(1);
      expect(stats.registeredViewingKeys).toBe(1);
    });
  });

  describe('createComplianceManager factory', () => {
    it('should create manager with defaults', () => {
      const manager = createComplianceManager();

      expect(manager).toBeInstanceOf(ComplianceManager);
    });

    it('should create manager with custom config', () => {
      const manager = createComplianceManager({
        velocityThresholds: {
          maxTransactionsPerHour: 5,
        },
      });

      expect(manager).toBeInstanceOf(ComplianceManager);
    });
  });
});
