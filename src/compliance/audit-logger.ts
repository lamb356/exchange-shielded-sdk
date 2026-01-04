/**
 * Audit Logger Module
 *
 * Provides tamper-evident audit logging for compliance and security monitoring.
 * All audit events are stored with cryptographic integrity protection.
 *
 * SECURITY REQUIREMENTS:
 * - Audit logs are tamper-evident (include hashes of previous entries)
 * - Sensitive data is automatically redacted
 * - Logs can be exported for compliance review
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import { redactSensitiveData } from '../security/sanitizer.js';

/**
 * Types of audit events
 */
export enum AuditEventType {
  // Withdrawal events
  WITHDRAWAL_REQUESTED = 'WITHDRAWAL_REQUESTED',
  WITHDRAWAL_APPROVED = 'WITHDRAWAL_APPROVED',
  WITHDRAWAL_COMPLETED = 'WITHDRAWAL_COMPLETED',
  WITHDRAWAL_FAILED = 'WITHDRAWAL_FAILED',
  WITHDRAWAL_CANCELLED = 'WITHDRAWAL_CANCELLED',

  // Key management events
  KEY_LOADED = 'KEY_LOADED',
  KEY_CLEARED = 'KEY_CLEARED',
  KEY_ACCESS = 'KEY_ACCESS',

  // Rate limiting events
  RATE_LIMIT_HIT = 'RATE_LIMIT_HIT',
  RATE_LIMIT_RESET = 'RATE_LIMIT_RESET',

  // Security events
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  CONFIGURATION_CHANGED = 'CONFIGURATION_CHANGED',

  // Compliance events
  COMPLIANCE_CHECK = 'COMPLIANCE_CHECK',
  VIEWING_KEY_EXPORTED = 'VIEWING_KEY_EXPORTED',
  REPORT_GENERATED = 'REPORT_GENERATED',
}

/**
 * Severity levels for audit events
 */
export enum AuditSeverity {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

/**
 * An audit event record
 */
export interface AuditEvent {
  /** Unique event ID */
  id: string;
  /** Event timestamp */
  timestamp: Date;
  /** Type of event */
  eventType: AuditEventType;
  /** Event severity */
  severity: AuditSeverity;
  /** User ID associated with the event */
  userId?: string;
  /** Transaction ID if applicable */
  transactionId?: string;
  /** Amount in ZEC if applicable */
  amount?: number;
  /** Destination address (redacted for shielded) */
  destinationAddress?: string;
  /** Additional event-specific metadata */
  metadata?: Record<string, unknown>;
  /** Hash of the previous event (for tamper detection) */
  previousHash?: string;
  /** Hash of this event */
  hash?: string;
}

/**
 * Stored audit event with all fields
 */
interface StoredAuditEvent extends Required<Pick<AuditEvent, 'id' | 'timestamp' | 'eventType' | 'severity' | 'previousHash' | 'hash'>> {
  userId?: string;
  transactionId?: string;
  amount?: number;
  destinationAddress?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Filter criteria for querying audit events
 */
export interface AuditFilter {
  /** Filter by event type(s) */
  eventTypes?: AuditEventType[];
  /** Filter by severity (minimum) */
  minSeverity?: AuditSeverity;
  /** Filter by user ID */
  userId?: string;
  /** Filter by transaction ID */
  transactionId?: string;
  /** Start date for time range */
  startDate?: Date;
  /** End date for time range */
  endDate?: Date;
  /** Maximum number of events to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Compliance report structure
 */
export interface ComplianceReport {
  /** Report generation timestamp */
  generatedAt: Date;
  /** Report period start */
  periodStart: Date;
  /** Report period end */
  periodEnd: Date;
  /** Summary statistics */
  summary: {
    totalEvents: number;
    withdrawalCount: number;
    totalWithdrawnAmount: number;
    failedWithdrawals: number;
    rateLimitHits: number;
    suspiciousActivityCount: number;
  };
  /** Categorized events */
  eventsByType: Record<AuditEventType, number>;
  /** Events by severity */
  eventsBySeverity: Record<AuditSeverity, number>;
  /** Detailed events (redacted) */
  events: AuditEvent[];
  /** Integrity verification */
  integrityCheck: {
    valid: boolean;
    firstEventHash: string;
    lastEventHash: string;
    chainVerified: boolean;
  };
}

/**
 * Audit logger configuration
 */
export interface AuditConfig {
  /** Maximum events to store in memory */
  maxEvents?: number;
  /** Minimum severity level to log */
  minSeverity?: AuditSeverity;
  /** Whether to automatically redact sensitive data */
  autoRedact?: boolean;
  /** Custom event handler for external logging */
  onEvent?: (event: AuditEvent) => void;
  /** Whether to verify chain integrity on each log */
  verifyChainOnLog?: boolean;
}

/**
 * Severity ordering for comparison
 */
const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  [AuditSeverity.DEBUG]: 0,
  [AuditSeverity.INFO]: 1,
  [AuditSeverity.WARNING]: 2,
  [AuditSeverity.ERROR]: 3,
  [AuditSeverity.CRITICAL]: 4,
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<Omit<AuditConfig, 'onEvent'>> = {
  maxEvents: 100000,
  minSeverity: AuditSeverity.INFO,
  autoRedact: true,
  verifyChainOnLog: false,
};

/**
 * Genesis hash for the first event in the chain
 */
const GENESIS_HASH = '0'.repeat(64);

/**
 * Audit Logger
 *
 * Provides tamper-evident audit logging with cryptographic integrity.
 * Each event includes a hash of the previous event, creating an
 * immutable chain that can be verified for tampering.
 *
 * @example
 * ```typescript
 * const logger = new AuditLogger();
 *
 * // Log a withdrawal request
 * logger.log({
 *   eventType: AuditEventType.WITHDRAWAL_REQUESTED,
 *   userId: 'user-123',
 *   amount: 10.5,
 *   destinationAddress: 'zs1...'
 * });
 *
 * // Query events
 * const events = logger.getEvents({
 *   eventTypes: [AuditEventType.WITHDRAWAL_REQUESTED],
 *   startDate: new Date('2024-01-01')
 * });
 *
 * // Generate compliance report
 * const report = logger.exportForCompliance(
 *   new Date('2024-01-01'),
 *   new Date('2024-12-31')
 * );
 * ```
 */
export class AuditLogger {
  /** Stored events */
  private readonly events: StoredAuditEvent[];

  /** Configuration */
  private readonly config: Required<Omit<AuditConfig, 'onEvent'>> & Pick<AuditConfig, 'onEvent'>;

  /** Counter for event IDs */
  private eventCounter: number;

  /** Hash of the last event */
  private lastHash: string;

  /**
   * Creates a new AuditLogger
   *
   * @param config - Logger configuration
   */
  constructor(config: AuditConfig = {}) {
    this.events = [];
    this.eventCounter = 0;
    this.lastHash = GENESIS_HASH;

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Logs an audit event
   *
   * @param event - The event to log (without id, timestamp, and hash fields)
   * @returns The logged event with all fields populated
   */
  log(event: Omit<AuditEvent, 'id' | 'timestamp' | 'previousHash' | 'hash'>): AuditEvent {
    // Check severity filter
    const severity = event.severity ?? AuditSeverity.INFO;
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[this.config.minSeverity]) {
      // Don't log events below minimum severity
      return {
        ...event,
        id: '',
        timestamp: new Date(),
        severity,
      };
    }

    // Generate event ID
    const id = this.generateEventId();
    const timestamp = new Date();

    // Redact sensitive data if configured
    let metadata = event.metadata;
    let destinationAddress = event.destinationAddress;

    if (this.config.autoRedact) {
      if (metadata) {
        metadata = redactSensitiveData(metadata) as Record<string, unknown>;
      }
      if (destinationAddress && destinationAddress.startsWith('zs')) {
        // Partially redact shielded addresses
        destinationAddress =
          destinationAddress.slice(0, 6) + '...' + destinationAddress.slice(-4);
      }
    }

    // Create the event record
    const storedEvent: StoredAuditEvent = {
      id,
      timestamp,
      eventType: event.eventType,
      severity,
      userId: event.userId,
      transactionId: event.transactionId,
      amount: event.amount,
      destinationAddress,
      metadata,
      previousHash: this.lastHash,
      hash: '', // Will be computed
    };

    // Compute hash
    storedEvent.hash = this.computeEventHash(storedEvent);
    this.lastHash = storedEvent.hash;

    // Verify chain integrity if configured
    if (this.config.verifyChainOnLog && this.events.length > 0) {
      const lastEvent = this.events[this.events.length - 1];
      if (lastEvent && lastEvent.hash !== storedEvent.previousHash) {
        // Chain integrity compromised - log critical event
        console.error('[AuditLogger] CRITICAL: Chain integrity compromised!');
      }
    }

    // Store the event
    this.events.push(storedEvent);

    // Enforce max events limit
    while (this.events.length > this.config.maxEvents) {
      this.events.shift();
    }

    // Call external handler if configured
    if (this.config.onEvent) {
      try {
        this.config.onEvent(storedEvent);
      } catch (error) {
        console.error('[AuditLogger] Error in event handler:', error);
      }
    }

    return storedEvent;
  }

  /**
   * Gets events matching the given filter
   *
   * @param filter - Filter criteria
   * @returns Array of matching events
   */
  getEvents(filter: AuditFilter = {}): AuditEvent[] {
    let filtered = [...this.events];

    // Filter by event types
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      const types = new Set(filter.eventTypes);
      filtered = filtered.filter((e) => types.has(e.eventType));
    }

    // Filter by minimum severity
    if (filter.minSeverity) {
      const minOrder = SEVERITY_ORDER[filter.minSeverity];
      filtered = filtered.filter((e) => SEVERITY_ORDER[e.severity] >= minOrder);
    }

    // Filter by user ID
    if (filter.userId) {
      filtered = filtered.filter((e) => e.userId === filter.userId);
    }

    // Filter by transaction ID
    if (filter.transactionId) {
      filtered = filtered.filter((e) => e.transactionId === filter.transactionId);
    }

    // Filter by date range
    if (filter.startDate) {
      const start = filter.startDate.getTime();
      filtered = filtered.filter((e) => e.timestamp.getTime() >= start);
    }

    if (filter.endDate) {
      const end = filter.endDate.getTime();
      filtered = filtered.filter((e) => e.timestamp.getTime() <= end);
    }

    // Apply pagination
    if (filter.offset) {
      filtered = filtered.slice(filter.offset);
    }

    if (filter.limit) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  /**
   * Exports events for compliance review
   *
   * @param startDate - Start of report period
   * @param endDate - End of report period
   * @returns Compliance report
   */
  exportForCompliance(startDate: Date, endDate: Date): ComplianceReport {
    const events = this.getEvents({ startDate, endDate });

    // Calculate summary statistics
    let withdrawalCount = 0;
    let totalWithdrawnAmount = 0;
    let failedWithdrawals = 0;
    let rateLimitHits = 0;
    let suspiciousActivityCount = 0;

    const eventsByType: Record<AuditEventType, number> = {} as Record<AuditEventType, number>;
    const eventsBySeverity: Record<AuditSeverity, number> = {} as Record<AuditSeverity, number>;

    // Initialize counters
    for (const type of Object.values(AuditEventType)) {
      eventsByType[type] = 0;
    }
    for (const severity of Object.values(AuditSeverity)) {
      eventsBySeverity[severity] = 0;
    }

    // Process events
    for (const event of events) {
      eventsByType[event.eventType]++;
      eventsBySeverity[event.severity]++;

      switch (event.eventType) {
        case AuditEventType.WITHDRAWAL_COMPLETED:
          withdrawalCount++;
          if (event.amount) {
            totalWithdrawnAmount += event.amount;
          }
          break;
        case AuditEventType.WITHDRAWAL_FAILED:
          failedWithdrawals++;
          break;
        case AuditEventType.RATE_LIMIT_HIT:
          rateLimitHits++;
          break;
        case AuditEventType.SUSPICIOUS_ACTIVITY:
          suspiciousActivityCount++;
          break;
      }
    }

    // Verify chain integrity
    const integrityCheck = this.verifyChainIntegrity(events);

    return {
      generatedAt: new Date(),
      periodStart: startDate,
      periodEnd: endDate,
      summary: {
        totalEvents: events.length,
        withdrawalCount,
        totalWithdrawnAmount,
        failedWithdrawals,
        rateLimitHits,
        suspiciousActivityCount,
      },
      eventsByType,
      eventsBySeverity,
      events,
      integrityCheck,
    };
  }

  /**
   * Verifies the integrity of the audit log chain
   *
   * @returns Verification result
   */
  verifyIntegrity(): { valid: boolean; brokenAt?: number } {
    if (this.events.length === 0) {
      return { valid: true };
    }

    // Check first event links to genesis
    const firstEvent = this.events[0];
    if (firstEvent && firstEvent.previousHash !== GENESIS_HASH) {
      return { valid: false, brokenAt: 0 };
    }

    // Verify each event's hash and chain link
    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      if (!event) continue;

      // Verify event hash
      const computedHash = this.computeEventHash(event);
      if (computedHash !== event.hash) {
        return { valid: false, brokenAt: i };
      }

      // Verify chain link (except for first event)
      if (i > 0) {
        const previousEvent = this.events[i - 1];
        if (previousEvent && event.previousHash !== previousEvent.hash) {
          return { valid: false, brokenAt: i };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Gets the total number of stored events
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Gets the hash of the last event
   */
  getLastHash(): string {
    return this.lastHash;
  }

  /**
   * Clears all stored events
   * WARNING: This should only be used in development/testing
   */
  clear(): void {
    this.events.length = 0;
    this.eventCounter = 0;
    this.lastHash = GENESIS_HASH;
  }

  /**
   * Generates a unique event ID
   */
  private generateEventId(): string {
    const timestamp = Date.now().toString(36);
    const counter = (++this.eventCounter).toString(36).padStart(6, '0');
    return `audit-${timestamp}-${counter}`;
  }

  /**
   * Computes the hash of an event
   */
  private computeEventHash(event: StoredAuditEvent): string {
    const data = JSON.stringify({
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      eventType: event.eventType,
      severity: event.severity,
      userId: event.userId,
      transactionId: event.transactionId,
      amount: event.amount,
      destinationAddress: event.destinationAddress,
      metadata: event.metadata,
      previousHash: event.previousHash,
    });

    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Verifies chain integrity for a subset of events
   */
  private verifyChainIntegrity(events: AuditEvent[]): {
    valid: boolean;
    firstEventHash: string;
    lastEventHash: string;
    chainVerified: boolean;
  } {
    if (events.length === 0) {
      return {
        valid: true,
        firstEventHash: GENESIS_HASH,
        lastEventHash: GENESIS_HASH,
        chainVerified: true,
      };
    }

    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];

    // Verify chain links
    let chainValid = true;
    for (let i = 1; i < events.length; i++) {
      const current = events[i];
      const previous = events[i - 1];
      if (current && previous && current.previousHash !== previous.hash) {
        chainValid = false;
        break;
      }
    }

    return {
      valid: chainValid,
      firstEventHash: firstEvent?.hash ?? GENESIS_HASH,
      lastEventHash: lastEvent?.hash ?? GENESIS_HASH,
      chainVerified: chainValid,
    };
  }
}

/**
 * Creates a new AuditLogger instance
 *
 * @param config - Logger configuration
 * @returns A new AuditLogger
 */
export function createAuditLogger(config?: AuditConfig): AuditLogger {
  return new AuditLogger(config);
}

/**
 * Helper to map event types to default severity
 */
export function getDefaultSeverity(eventType: AuditEventType): AuditSeverity {
  switch (eventType) {
    case AuditEventType.WITHDRAWAL_COMPLETED:
    case AuditEventType.KEY_LOADED:
    case AuditEventType.KEY_CLEARED:
    case AuditEventType.COMPLIANCE_CHECK:
    case AuditEventType.REPORT_GENERATED:
      return AuditSeverity.INFO;

    case AuditEventType.WITHDRAWAL_REQUESTED:
    case AuditEventType.WITHDRAWAL_APPROVED:
    case AuditEventType.KEY_ACCESS:
    case AuditEventType.VIEWING_KEY_EXPORTED:
      return AuditSeverity.INFO;

    case AuditEventType.RATE_LIMIT_HIT:
    case AuditEventType.RATE_LIMIT_RESET:
    case AuditEventType.WITHDRAWAL_CANCELLED:
    case AuditEventType.CONFIGURATION_CHANGED:
      return AuditSeverity.WARNING;

    case AuditEventType.WITHDRAWAL_FAILED:
    case AuditEventType.AUTHENTICATION_FAILED:
      return AuditSeverity.ERROR;

    case AuditEventType.SUSPICIOUS_ACTIVITY:
    case AuditEventType.UNAUTHORIZED_ACCESS:
      return AuditSeverity.CRITICAL;

    default:
      return AuditSeverity.INFO;
  }
}
