/**
 * Compliance Manager Module
 *
 * Provides compliance-related functionality including viewing key export,
 * velocity checks, suspicious activity detection, and report generation.
 *
 * @packageDocumentation
 */

import { createHash, randomBytes } from 'crypto';
import {
  AuditLogger,
  AuditEventType,
  AuditSeverity,
  ComplianceReport,
  createAuditLogger,
} from './audit-logger.js';

/**
 * Date range for reports
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Viewing key export format
 */
export interface ViewingKeyExport {
  /** Key identifier */
  keyId: string;
  /** The viewing key data (hex encoded) */
  viewingKey: string;
  /** Key type */
  keyType: 'sapling' | 'orchard' | 'unified';
  /** Export timestamp */
  exportedAt: Date;
  /** Expiration time (if any) */
  expiresAt?: Date;
  /** Purpose of export */
  purpose: string;
  /** Checksum for verification */
  checksum: string;
}

/**
 * Viewing key bundle for multiple keys
 */
export interface ViewingKeyBundle {
  /** Bundle identifier */
  bundleId: string;
  /** Export timestamp */
  exportedAt: Date;
  /** Exported keys */
  keys: ViewingKeyExport[];
  /** Bundle integrity hash */
  bundleHash: string;
}

/**
 * Velocity check result
 */
export interface VelocityCheckResult {
  /** Whether the velocity is within acceptable limits */
  passed: boolean;
  /** Current velocity statistics */
  velocity: {
    /** Transactions in the last hour */
    lastHour: number;
    /** Transactions in the last 24 hours */
    last24Hours: number;
    /** Total amount in the last hour */
    amountLastHour: number;
    /** Total amount in the last 24 hours */
    amountLast24Hours: number;
  };
  /** Velocity thresholds */
  thresholds: {
    maxTransactionsPerHour: number;
    maxTransactionsPerDay: number;
    maxAmountPerHour: number;
    maxAmountPerDay: number;
  };
  /** Reason for failure (if applicable) */
  reason?: string;
  /** Risk score (0-100) */
  riskScore: number;
}

/**
 * Suspicious activity flag
 */
export interface SuspiciousActivityFlag {
  /** Flag identifier */
  id: string;
  /** User ID */
  userId: string;
  /** Reason for flag */
  reason: string;
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Flag timestamp */
  flaggedAt: Date;
  /** Additional details */
  details?: Record<string, unknown>;
  /** Whether the flag has been reviewed */
  reviewed: boolean;
  /** Review timestamp */
  reviewedAt?: Date;
  /** Review notes */
  reviewNotes?: string;
}

/**
 * Velocity thresholds configuration
 */
export interface VelocityThresholds {
  /** Maximum transactions per hour */
  maxTransactionsPerHour: number;
  /** Maximum transactions per day */
  maxTransactionsPerDay: number;
  /** Maximum amount per hour (in ZEC) */
  maxAmountPerHour: number;
  /** Maximum amount per day (in ZEC) */
  maxAmountPerDay: number;
}

/**
 * Compliance manager configuration
 */
export interface ComplianceConfig {
  /** Velocity check thresholds */
  velocityThresholds?: Partial<VelocityThresholds>;
  /** Viewing key export validity period (ms) */
  viewingKeyValidityMs?: number;
  /** Audit logger instance (or will create one) */
  auditLogger?: AuditLogger;
}

/**
 * Transaction record for velocity tracking
 */
interface TransactionRecord {
  userId: string;
  amount: number;
  timestamp: number;
}

/**
 * Default velocity thresholds
 */
const DEFAULT_VELOCITY_THRESHOLDS: VelocityThresholds = {
  maxTransactionsPerHour: 10,
  maxTransactionsPerDay: 50,
  maxAmountPerHour: 100,
  maxAmountPerDay: 1000,
};

/**
 * Time constants
 */
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compliance Manager
 *
 * Handles compliance-related operations including:
 * - Viewing key export for auditors
 * - Velocity checks for unusual activity
 * - Suspicious activity detection and flagging
 * - Compliance report generation
 *
 * @example
 * ```typescript
 * const compliance = new ComplianceManager({
 *   velocityThresholds: {
 *     maxTransactionsPerHour: 5,
 *     maxAmountPerDay: 500
 *   }
 * });
 *
 * // Check velocity before processing withdrawal
 * const velocityResult = compliance.checkVelocity('user-123', 10.0);
 * if (!velocityResult.passed) {
 *   console.log('Velocity check failed:', velocityResult.reason);
 * }
 *
 * // Flag suspicious activity
 * compliance.flagSuspiciousActivity('user-456', 'Multiple failed withdrawals');
 *
 * // Generate compliance report
 * const report = compliance.generateComplianceReport({
 *   start: new Date('2024-01-01'),
 *   end: new Date('2024-12-31')
 * });
 * ```
 */
export class ComplianceManager {
  /** Velocity thresholds */
  private readonly thresholds: VelocityThresholds;

  /** Viewing key validity period */
  private readonly viewingKeyValidityMs: number;

  /** Audit logger */
  private readonly auditLogger: AuditLogger;

  /** Transaction history for velocity tracking */
  private readonly transactionHistory: TransactionRecord[];

  /** Suspicious activity flags */
  private readonly suspiciousFlags: Map<string, SuspiciousActivityFlag[]>;

  /** Viewing key storage (simulated) */
  private readonly viewingKeys: Map<string, { viewingKey: string; keyType: 'sapling' | 'orchard' | 'unified' }>;

  /** Flag counter */
  private flagCounter: number;

  /**
   * Creates a new ComplianceManager
   *
   * @param config - Configuration options
   */
  constructor(config: ComplianceConfig = {}) {
    this.thresholds = {
      ...DEFAULT_VELOCITY_THRESHOLDS,
      ...config.velocityThresholds,
    };

    this.viewingKeyValidityMs = config.viewingKeyValidityMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.auditLogger = config.auditLogger ?? createAuditLogger();
    this.transactionHistory = [];
    this.suspiciousFlags = new Map();
    this.viewingKeys = new Map();
    this.flagCounter = 0;
  }

  /**
   * Exports a viewing key for compliance/audit purposes
   *
   * Note: In a real implementation, this would derive the viewing key
   * from the spending key using librustzcash. This is a simplified version.
   *
   * @param spendingKeyId - The ID of the spending key
   * @param purpose - Purpose of the export (for audit trail)
   * @returns The exported viewing key
   */
  exportViewingKey(spendingKeyId: string, purpose: string = 'compliance_audit'): ViewingKeyExport {
    // In production, this would derive the viewing key from the spending key
    // For now, we simulate this with stored viewing keys
    const storedKey = this.viewingKeys.get(spendingKeyId);

    if (!storedKey) {
      throw new Error(`No viewing key found for spending key ID: ${spendingKeyId}`);
    }

    const exportedAt = new Date();
    const expiresAt = new Date(exportedAt.getTime() + this.viewingKeyValidityMs);

    const viewingKey = storedKey.viewingKey;
    const checksum = this.computeChecksum(viewingKey);

    const exportData: ViewingKeyExport = {
      keyId: spendingKeyId,
      viewingKey,
      keyType: storedKey.keyType,
      exportedAt,
      expiresAt,
      purpose,
      checksum,
    };

    // Log the export
    this.auditLogger.log({
      eventType: AuditEventType.VIEWING_KEY_EXPORTED,
      severity: AuditSeverity.WARNING,
      metadata: {
        keyId: spendingKeyId,
        purpose,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return exportData;
  }

  /**
   * Exports all viewing keys as a bundle
   *
   * @param purpose - Purpose of the export
   * @returns Bundle of viewing keys
   */
  exportViewingKeys(purpose: string = 'compliance_audit'): ViewingKeyBundle {
    const keys: ViewingKeyExport[] = [];

    for (const keyId of this.viewingKeys.keys()) {
      try {
        const exported = this.exportViewingKey(keyId, purpose);
        keys.push(exported);
      } catch {
        // Skip keys that can't be exported
      }
    }

    const bundleId = `bundle-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const exportedAt = new Date();

    // Compute bundle hash
    const bundleData = JSON.stringify(keys.map((k) => k.checksum));
    const bundleHash = createHash('sha256').update(bundleData).digest('hex');

    return {
      bundleId,
      exportedAt,
      keys,
      bundleHash,
    };
  }

  /**
   * Registers a viewing key for later export
   *
   * @param spendingKeyId - The spending key identifier
   * @param viewingKey - The viewing key data (hex encoded)
   * @param keyType - The key type
   */
  registerViewingKey(
    spendingKeyId: string,
    viewingKey: string,
    keyType: 'sapling' | 'orchard' | 'unified'
  ): void {
    this.viewingKeys.set(spendingKeyId, { viewingKey, keyType });
  }

  /**
   * Checks velocity for a user before processing a withdrawal
   *
   * @param userId - The user identifier
   * @param amount - The withdrawal amount
   * @returns Velocity check result
   */
  checkVelocity(userId: string, amount: number): VelocityCheckResult {
    const now = Date.now();
    const hourAgo = now - MS_PER_HOUR;
    const dayAgo = now - MS_PER_DAY;

    // Clean up old records
    this.cleanupOldTransactions(dayAgo);

    // Get user's transactions
    const userTransactions = this.transactionHistory.filter((t) => t.userId === userId);

    // Calculate velocity
    let lastHour = 0;
    let last24Hours = 0;
    let amountLastHour = 0;
    let amountLast24Hours = 0;

    for (const tx of userTransactions) {
      if (tx.timestamp >= dayAgo) {
        last24Hours++;
        amountLast24Hours += tx.amount;
      }
      if (tx.timestamp >= hourAgo) {
        lastHour++;
        amountLastHour += tx.amount;
      }
    }

    // Include the current transaction in projections
    const projectedLastHour = lastHour + 1;
    const projectedLast24Hours = last24Hours + 1;
    const projectedAmountLastHour = amountLastHour + amount;
    const projectedAmountLast24Hours = amountLast24Hours + amount;

    // Calculate risk score
    const riskScore = this.calculateRiskScore(
      projectedLastHour,
      projectedLast24Hours,
      projectedAmountLastHour,
      projectedAmountLast24Hours
    );

    const velocity = {
      lastHour,
      last24Hours,
      amountLastHour,
      amountLast24Hours,
    };

    // Check thresholds
    if (projectedLastHour > this.thresholds.maxTransactionsPerHour) {
      return {
        passed: false,
        velocity,
        thresholds: this.thresholds,
        reason: `Hourly transaction limit exceeded (${projectedLastHour}/${this.thresholds.maxTransactionsPerHour})`,
        riskScore,
      };
    }

    if (projectedLast24Hours > this.thresholds.maxTransactionsPerDay) {
      return {
        passed: false,
        velocity,
        thresholds: this.thresholds,
        reason: `Daily transaction limit exceeded (${projectedLast24Hours}/${this.thresholds.maxTransactionsPerDay})`,
        riskScore,
      };
    }

    if (projectedAmountLastHour > this.thresholds.maxAmountPerHour) {
      return {
        passed: false,
        velocity,
        thresholds: this.thresholds,
        reason: `Hourly amount limit exceeded (${projectedAmountLastHour}/${this.thresholds.maxAmountPerHour} ZEC)`,
        riskScore,
      };
    }

    if (projectedAmountLast24Hours > this.thresholds.maxAmountPerDay) {
      return {
        passed: false,
        velocity,
        thresholds: this.thresholds,
        reason: `Daily amount limit exceeded (${projectedAmountLast24Hours}/${this.thresholds.maxAmountPerDay} ZEC)`,
        riskScore,
      };
    }

    // Log the check
    this.auditLogger.log({
      eventType: AuditEventType.COMPLIANCE_CHECK,
      severity: riskScore > 50 ? AuditSeverity.WARNING : AuditSeverity.INFO,
      userId,
      amount,
      metadata: {
        checkType: 'velocity',
        passed: true,
        riskScore,
      },
    });

    return {
      passed: true,
      velocity,
      thresholds: this.thresholds,
      riskScore,
    };
  }

  /**
   * Records a transaction for velocity tracking
   *
   * @param userId - The user identifier
   * @param amount - The transaction amount
   */
  recordTransaction(userId: string, amount: number): void {
    this.transactionHistory.push({
      userId,
      amount,
      timestamp: Date.now(),
    });
  }

  /**
   * Flags suspicious activity for a user
   *
   * @param userId - The user identifier
   * @param reason - Reason for flagging
   * @param details - Additional details
   * @returns The created flag
   */
  flagSuspiciousActivity(
    userId: string,
    reason: string,
    details?: Record<string, unknown>
  ): SuspiciousActivityFlag {
    const severity = this.determineSeverity(reason);
    const flagId = `flag-${Date.now().toString(36)}-${(++this.flagCounter).toString(36)}`;

    const flag: SuspiciousActivityFlag = {
      id: flagId,
      userId,
      reason,
      severity,
      flaggedAt: new Date(),
      details,
      reviewed: false,
    };

    // Store the flag
    const userFlags = this.suspiciousFlags.get(userId) ?? [];
    userFlags.push(flag);
    this.suspiciousFlags.set(userId, userFlags);

    // Log to audit
    this.auditLogger.log({
      eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
      severity: this.mapSeverityToAudit(severity),
      userId,
      metadata: {
        flagId,
        reason,
        severity,
        ...details,
      },
    });

    return flag;
  }

  /**
   * Gets all flags for a user
   *
   * @param userId - The user identifier
   * @param includeReviewed - Whether to include reviewed flags
   */
  getUserFlags(userId: string, includeReviewed: boolean = false): SuspiciousActivityFlag[] {
    const flags = this.suspiciousFlags.get(userId) ?? [];
    if (includeReviewed) {
      return [...flags];
    }
    return flags.filter((f) => !f.reviewed);
  }

  /**
   * Marks a flag as reviewed
   *
   * @param flagId - The flag identifier
   * @param notes - Review notes
   */
  reviewFlag(flagId: string, notes: string): boolean {
    for (const flags of this.suspiciousFlags.values()) {
      const flag = flags.find((f) => f.id === flagId);
      if (flag) {
        flag.reviewed = true;
        flag.reviewedAt = new Date();
        flag.reviewNotes = notes;
        return true;
      }
    }
    return false;
  }

  /**
   * Generates a compliance report for a given period
   *
   * @param period - The report period
   * @returns Compliance report
   */
  generateComplianceReport(period: DateRange): ComplianceReport {
    const report = this.auditLogger.exportForCompliance(period.start, period.end);

    // Log report generation
    this.auditLogger.log({
      eventType: AuditEventType.REPORT_GENERATED,
      severity: AuditSeverity.INFO,
      metadata: {
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
        totalEvents: report.summary.totalEvents,
      },
    });

    return report;
  }

  /**
   * Gets summary statistics
   */
  getStatistics(): {
    totalTransactionsTracked: number;
    totalFlagsActive: number;
    totalFlagsReviewed: number;
    registeredViewingKeys: number;
  } {
    let totalFlagsActive = 0;
    let totalFlagsReviewed = 0;

    for (const flags of this.suspiciousFlags.values()) {
      for (const flag of flags) {
        if (flag.reviewed) {
          totalFlagsReviewed++;
        } else {
          totalFlagsActive++;
        }
      }
    }

    return {
      totalTransactionsTracked: this.transactionHistory.length,
      totalFlagsActive,
      totalFlagsReviewed,
      registeredViewingKeys: this.viewingKeys.size,
    };
  }

  /**
   * Cleans up old transaction records
   */
  private cleanupOldTransactions(cutoff: number): void {
    let i = 0;
    while (i < this.transactionHistory.length) {
      const tx = this.transactionHistory[i];
      if (tx && tx.timestamp < cutoff) {
        this.transactionHistory.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  /**
   * Calculates a risk score based on velocity
   */
  private calculateRiskScore(
    txHour: number,
    txDay: number,
    amountHour: number,
    amountDay: number
  ): number {
    const hourlyTxRatio = txHour / this.thresholds.maxTransactionsPerHour;
    const dailyTxRatio = txDay / this.thresholds.maxTransactionsPerDay;
    const hourlyAmountRatio = amountHour / this.thresholds.maxAmountPerHour;
    const dailyAmountRatio = amountDay / this.thresholds.maxAmountPerDay;

    // Weight the factors
    const weightedScore =
      hourlyTxRatio * 30 +
      dailyTxRatio * 20 +
      hourlyAmountRatio * 30 +
      dailyAmountRatio * 20;

    return Math.min(100, Math.round(weightedScore));
  }

  /**
   * Determines severity based on reason
   */
  private determineSeverity(reason: string): 'low' | 'medium' | 'high' | 'critical' {
    const lowerReason = reason.toLowerCase();

    if (
      lowerReason.includes('fraud') ||
      lowerReason.includes('theft') ||
      lowerReason.includes('compromised')
    ) {
      return 'critical';
    }

    if (
      lowerReason.includes('failed') ||
      lowerReason.includes('velocity') ||
      lowerReason.includes('limit')
    ) {
      return 'high';
    }

    if (lowerReason.includes('unusual') || lowerReason.includes('pattern')) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Maps internal severity to audit severity
   */
  private mapSeverityToAudit(severity: 'low' | 'medium' | 'high' | 'critical'): AuditSeverity {
    switch (severity) {
      case 'low':
        return AuditSeverity.INFO;
      case 'medium':
        return AuditSeverity.WARNING;
      case 'high':
        return AuditSeverity.ERROR;
      case 'critical':
        return AuditSeverity.CRITICAL;
    }
  }

  /**
   * Computes checksum for viewing key
   */
  private computeChecksum(data: string): string {
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }
}

/**
 * Creates a new ComplianceManager instance
 *
 * @param config - Configuration options
 * @returns A new ComplianceManager
 */
export function createComplianceManager(config?: ComplianceConfig): ComplianceManager {
  return new ComplianceManager(config);
}
