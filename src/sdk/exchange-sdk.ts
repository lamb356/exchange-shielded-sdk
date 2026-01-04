/**
 * Exchange Shielded SDK
 *
 * High-level SDK wrapper for exchange integration with shielded withdrawals.
 * Provides a unified API that combines transaction building, RPC communication,
 * security, and compliance features.
 *
 * @packageDocumentation
 */

import { ShieldedTransactionBuilder, PendingTransaction } from '../transaction-builder.js';
import { ZcashRpcClient, RpcConfig, OperationResult } from '../rpc-client.js';
import { SecureKeyManager, KeyManagerConfig } from '../security/key-manager.js';
import {
  WithdrawalRateLimiter,
  RateLimitConfig,
  RateLimitResult,
} from '../security/rate-limiter.js';
import {
  sanitizeAddress,
  sanitizeAmount,
  sanitizeMemo,
  redactSensitiveData,
} from '../security/sanitizer.js';
import {
  AuditLogger,
  AuditEventType,
  AuditSeverity,
  ComplianceReport,
} from '../compliance/audit-logger.js';
import {
  ComplianceManager,
  DateRange,
  ViewingKeyBundle,
  VelocityCheckResult,
} from '../compliance/compliance.js';

/**
 * SDK configuration
 */
export interface SDKConfig {
  /** RPC configuration for zcashd */
  rpc: RpcConfig;
  /** Key manager configuration */
  keyManager?: KeyManagerConfig;
  /** Rate limiter configuration */
  rateLimiter?: Partial<RateLimitConfig>;
  /** Enable compliance features */
  enableCompliance?: boolean;
  /** Enable audit logging */
  enableAuditLogging?: boolean;
  /** Minimum confirmations for inputs */
  minconf?: number;
  /** Default privacy policy */
  privacyPolicy?:
    | 'FullPrivacy'
    | 'LegacyCompat'
    | 'AllowRevealedAmounts'
    | 'AllowRevealedRecipients';
}

/**
 * Withdrawal request
 */
export interface WithdrawalRequest {
  /** User ID making the request */
  userId: string;
  /** Source address (shielded) */
  fromAddress: string;
  /** Destination address */
  toAddress: string;
  /** Amount in ZEC */
  amount: number;
  /** Optional memo (for shielded recipients) */
  memo?: string;
  /** Optional request ID for tracking */
  requestId?: string;
}

/**
 * Withdrawal result
 */
export interface WithdrawalResult {
  /** Whether the withdrawal was successful */
  success: boolean;
  /** Transaction ID if successful */
  transactionId?: string;
  /** Operation ID for tracking */
  operationId?: string;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: string;
  /** Fee paid (in ZEC) */
  fee?: number;
  /** Request ID from the original request */
  requestId?: string;
  /** Timestamp of completion */
  completedAt?: Date;
}

/**
 * Withdrawal status
 */
export interface WithdrawalStatus {
  /** Current status */
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'unknown';
  /** Transaction ID if available */
  transactionId?: string;
  /** Number of confirmations */
  confirmations?: number;
  /** Error message if failed */
  error?: string;
  /** Last updated timestamp */
  updatedAt: Date;
}

/**
 * Fee estimate
 */
export interface FeeEstimate {
  /** Estimated fee in ZEC */
  feeZec: number;
  /** Estimated fee in zatoshis */
  feeZatoshis: number;
  /** Number of logical actions */
  logicalActions: number;
  /** Whether the estimate is approximate */
  isApproximate: boolean;
}

/**
 * Exchange Shielded SDK
 *
 * Provides a high-level API for exchanges to process shielded withdrawals.
 * Integrates transaction building, RPC communication, security controls,
 * and compliance features.
 *
 * @example
 * ```typescript
 * const sdk = new ExchangeShieldedSDK({
 *   rpc: {
 *     host: '127.0.0.1',
 *     port: 8232,
 *     auth: { username: 'user', password: 'pass' }
 *   },
 *   enableCompliance: true,
 *   enableAuditLogging: true
 * });
 *
 * // Process a withdrawal
 * const result = await sdk.processWithdrawal({
 *   userId: 'user-123',
 *   fromAddress: 'zs1source...',
 *   toAddress: 'zs1dest...',
 *   amount: 10.5
 * });
 *
 * if (result.success) {
 *   console.log('Transaction ID:', result.transactionId);
 * }
 * ```
 */
export class ExchangeShieldedSDK {
  /** RPC client */
  private readonly rpcClient: ZcashRpcClient;

  /** Transaction builder */
  private readonly txBuilder: ShieldedTransactionBuilder;

  /** Key manager */
  private readonly keyManager: SecureKeyManager;

  /** Rate limiter */
  private readonly rateLimiter: WithdrawalRateLimiter;

  /** Audit logger */
  private readonly auditLogger: AuditLogger;

  /** Compliance manager */
  private readonly complianceManager: ComplianceManager;

  /** Configuration */
  private readonly config: SDKConfig;

  /** Pending operations tracking */
  private readonly pendingOperations: Map<string, { userId: string; requestId?: string }>;

  /**
   * Request ID cache for idempotency
   *
   * SECURITY: Prevents double-withdrawals when clients retry failed requests.
   * If a requestId has already been processed, the cached result is returned
   * instead of processing the withdrawal again.
   */
  private readonly requestIdCache: Map<string, WithdrawalResult>;

  /**
   * Creates a new ExchangeShieldedSDK
   *
   * @param config - SDK configuration
   */
  constructor(config: SDKConfig) {
    this.config = config;

    // Initialize RPC client
    this.rpcClient = new ZcashRpcClient(config.rpc);

    // Initialize transaction builder
    this.txBuilder = new ShieldedTransactionBuilder({
      minconf: config.minconf ?? 10,
      privacyPolicy: config.privacyPolicy ?? 'FullPrivacy',
    });

    // Initialize security components
    this.keyManager = new SecureKeyManager(config.keyManager);
    this.rateLimiter = new WithdrawalRateLimiter(config.rateLimiter);

    // Initialize compliance components
    this.auditLogger = new AuditLogger({
      autoRedact: true,
      minSeverity: AuditSeverity.INFO,
    });

    this.complianceManager = new ComplianceManager({
      auditLogger: this.auditLogger,
    });

    // Initialize pending operations tracking
    this.pendingOperations = new Map();

    // Initialize request ID cache for idempotency
    this.requestIdCache = new Map();
  }

  /**
   * Processes a withdrawal request
   *
   * This method:
   * 1. Validates and sanitizes all inputs
   * 2. Checks rate limits
   * 3. Performs velocity checks (if compliance enabled)
   * 4. Builds the transaction
   * 5. Submits to the network
   * 6. Waits for completion
   * 7. Logs all events
   *
   * @param request - The withdrawal request
   * @returns The withdrawal result
   */
  async processWithdrawal(request: WithdrawalRequest): Promise<WithdrawalResult> {
    const requestId = request.requestId ?? this.generateRequestId();

    // IDEMPOTENCY CHECK: If this requestId has already been processed, return cached result
    // This prevents double-withdrawals when clients retry failed network requests
    const cachedResult = this.requestIdCache.get(requestId);
    if (cachedResult !== undefined) {
      // Log that we returned a cached result
      if (this.config.enableAuditLogging !== false) {
        this.auditLogger.log({
          eventType: AuditEventType.WITHDRAWAL_REQUESTED,
          severity: AuditSeverity.INFO,
          userId: request.userId,
          metadata: {
            requestId,
            idempotentReturn: true,
            originalResult: cachedResult.success ? 'success' : 'failed',
          },
        });
      }
      return cachedResult;
    }

    try {
      // Log withdrawal request
      if (this.config.enableAuditLogging !== false) {
        this.auditLogger.log({
          eventType: AuditEventType.WITHDRAWAL_REQUESTED,
          severity: AuditSeverity.INFO,
          userId: request.userId,
          amount: request.amount,
          destinationAddress: request.toAddress,
          metadata: {
            requestId,
            fromAddress: request.fromAddress,
          },
        });
      }

      // Validate and sanitize inputs
      const fromResult = sanitizeAddress(request.fromAddress);
      if (!fromResult.valid) {
        return this.failWithdrawal(
          requestId,
          request.userId,
          fromResult.error ?? 'Invalid source address',
          'INVALID_FROM_ADDRESS'
        );
      }

      const toResult = sanitizeAddress(request.toAddress);
      if (!toResult.valid) {
        return this.failWithdrawal(
          requestId,
          request.userId,
          toResult.error ?? 'Invalid destination address',
          'INVALID_TO_ADDRESS'
        );
      }

      const amountResult = sanitizeAmount(request.amount);
      if (!amountResult.valid) {
        return this.failWithdrawal(
          requestId,
          request.userId,
          amountResult.error ?? 'Invalid amount',
          'INVALID_AMOUNT'
        );
      }

      // Sanitize memo if provided
      let memo: string | undefined;
      if (request.memo) {
        const memoResult = sanitizeMemo(request.memo);
        if (!memoResult.valid) {
          return this.failWithdrawal(
            requestId,
            request.userId,
            memoResult.error ?? 'Invalid memo',
            'INVALID_MEMO'
          );
        }
        memo = memoResult.memo;
      }

      // Check rate limits
      const rateLimitResult = this.rateLimiter.checkLimit(request.userId, amountResult.amount);
      if (!rateLimitResult.allowed) {
        if (this.config.enableAuditLogging !== false) {
          this.auditLogger.log({
            eventType: AuditEventType.RATE_LIMIT_HIT,
            severity: AuditSeverity.WARNING,
            userId: request.userId,
            amount: amountResult.amount,
            metadata: {
              requestId,
              reason: rateLimitResult.reason,
              usage: rateLimitResult.usage,
            },
          });
        }

        // Cache rate limit failures for idempotency (prevents repeated rate limit checks on retry)
        return this.failWithdrawalAndCache(
          requestId,
          request.userId,
          rateLimitResult.reason ?? 'Rate limit exceeded',
          'RATE_LIMITED'
        );
      }

      // Check velocity (if compliance enabled)
      if (this.config.enableCompliance !== false) {
        const velocityResult = this.complianceManager.checkVelocity(
          request.userId,
          amountResult.amount
        );

        if (!velocityResult.passed) {
          this.complianceManager.flagSuspiciousActivity(
            request.userId,
            velocityResult.reason ?? 'Velocity check failed',
            { requestId, amount: amountResult.amount }
          );

          // Cache velocity failures for idempotency
          return this.failWithdrawalAndCache(
            requestId,
            request.userId,
            velocityResult.reason ?? 'Velocity check failed',
            'VELOCITY_CHECK_FAILED'
          );
        }
      }

      // Log approval
      if (this.config.enableAuditLogging !== false) {
        this.auditLogger.log({
          eventType: AuditEventType.WITHDRAWAL_APPROVED,
          severity: AuditSeverity.INFO,
          userId: request.userId,
          amount: amountResult.amount,
          destinationAddress: toResult.address,
          metadata: { requestId },
        });
      }

      // Build the transaction
      const pendingTx = this.txBuilder.buildShieldedWithdrawal(
        fromResult.address,
        toResult.address,
        amountResult.amount,
        memo
      );

      // Prepare z_sendmany request
      const zsendmanyRequest = this.txBuilder.prepareZSendmany(pendingTx);

      // Submit to network
      const operationId = await this.rpcClient.executeZSendmany(zsendmanyRequest);

      // Track the operation
      this.pendingOperations.set(operationId, {
        userId: request.userId,
        requestId,
      });

      // Wait for completion
      const result = await this.rpcClient.waitForOperation(operationId);

      // Record the withdrawal
      this.rateLimiter.recordWithdrawal(request.userId, amountResult.amount);

      if (this.config.enableCompliance !== false) {
        this.complianceManager.recordTransaction(request.userId, amountResult.amount);
      }

      // Clean up tracking
      this.pendingOperations.delete(operationId);

      if (result.status === 'success' && result.result?.txid) {
        // Log success
        if (this.config.enableAuditLogging !== false) {
          this.auditLogger.log({
            eventType: AuditEventType.WITHDRAWAL_COMPLETED,
            severity: AuditSeverity.INFO,
            userId: request.userId,
            transactionId: result.result.txid,
            amount: amountResult.amount,
            destinationAddress: toResult.address,
            metadata: {
              requestId,
              operationId,
              executionTime: result.execution_secs,
            },
          });
        }

        const successResult: WithdrawalResult = {
          success: true,
          transactionId: result.result.txid,
          operationId,
          fee: zsendmanyRequest.fee ?? undefined,
          requestId,
          completedAt: new Date(),
        };

        // Cache the result for idempotency
        this.requestIdCache.set(requestId, successResult);

        return successResult;
      } else {
        const errorMessage = result.error?.message ?? 'Transaction failed';
        return this.failWithdrawalAndCache(requestId, request.userId, errorMessage, 'TX_FAILED');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Log with redacted error
      console.error('[SDK] Withdrawal failed:', redactSensitiveData({ error: errorMessage }));

      return this.failWithdrawalAndCache(requestId, request.userId, errorMessage, 'INTERNAL_ERROR');
    }
  }

  /**
   * Gets the status of a withdrawal by transaction ID
   *
   * @param txId - The transaction ID
   * @returns The withdrawal status
   */
  async getWithdrawalStatus(txId: string): Promise<WithdrawalStatus> {
    try {
      // In a full implementation, we would query the transaction status
      // from zcashd using getrawtransaction or similar

      // For now, return a basic status
      return {
        status: 'unknown',
        transactionId: txId,
        updatedAt: new Date(),
      };
    } catch (error) {
      return {
        status: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: new Date(),
      };
    }
  }

  /**
   * Estimates the fee for a withdrawal
   *
   * @param amount - The withdrawal amount
   * @param destination - The destination address
   * @returns Fee estimate
   */
  async estimateWithdrawalFee(amount: number, destination: string): Promise<FeeEstimate> {
    // Validate destination
    const destResult = sanitizeAddress(destination);
    if (!destResult.valid) {
      throw new Error(`Invalid destination address: ${destResult.error}`);
    }

    // Build a dummy transaction for estimation
    // Using a placeholder source address
    const placeholderSource = 'zs1placeholder' + '0'.repeat(60);

    try {
      const pendingTx: PendingTransaction = {
        from: placeholderSource,
        to: destResult.address,
        amount,
        createdAt: Date.now(),
        fromType: 'sapling',
        toType: destResult.type,
      };

      const feeZec = await this.txBuilder.estimateFee(pendingTx);
      const feeZatoshis = Math.round(feeZec * 100_000_000);

      return {
        feeZec,
        feeZatoshis,
        logicalActions: Math.ceil(feeZatoshis / 5000), // Approximate from fee
        isApproximate: true,
      };
    } catch {
      // Return minimum fee as fallback
      return {
        feeZec: 0.0001,
        feeZatoshis: 10000,
        logicalActions: 2,
        isApproximate: true,
      };
    }
  }

  /**
   * Gets a compliance report for a given period
   *
   * @param period - The report period
   * @returns Compliance report
   */
  async getComplianceReport(period: DateRange): Promise<ComplianceReport> {
    return this.complianceManager.generateComplianceReport(period);
  }

  /**
   * Exports viewing keys for compliance purposes
   *
   * @returns Bundle of viewing keys
   */
  async exportViewingKeys(): Promise<ViewingKeyBundle> {
    return this.complianceManager.exportViewingKeys('exchange_compliance_export');
  }

  /**
   * Checks rate limit status for a user
   *
   * @param userId - The user ID
   * @param amount - The amount to check
   * @returns Rate limit check result
   */
  checkRateLimit(userId: string, amount: number): RateLimitResult {
    return this.rateLimiter.checkLimit(userId, amount);
  }

  /**
   * Checks velocity for a user
   *
   * @param userId - The user ID
   * @param amount - The amount to check
   * @returns Velocity check result
   */
  checkVelocity(userId: string, amount: number): VelocityCheckResult {
    return this.complianceManager.checkVelocity(userId, amount);
  }

  /**
   * Gets the key manager instance
   * Note: Use with caution - for administrative purposes only
   */
  getKeyManager(): SecureKeyManager {
    return this.keyManager;
  }

  /**
   * Gets the audit logger instance
   */
  getAuditLogger(): AuditLogger {
    return this.auditLogger;
  }

  /**
   * Gets the compliance manager instance
   */
  getComplianceManager(): ComplianceManager {
    return this.complianceManager;
  }

  /**
   * Helper to create a failed withdrawal result (without caching)
   * Used for validation failures before the withdrawal is actually attempted.
   */
  private failWithdrawal(
    requestId: string,
    userId: string,
    error: string,
    errorCode: string
  ): WithdrawalResult {
    // Log failure
    if (this.config.enableAuditLogging !== false) {
      this.auditLogger.log({
        eventType: AuditEventType.WITHDRAWAL_FAILED,
        severity: AuditSeverity.ERROR,
        userId,
        metadata: {
          requestId,
          error,
          errorCode,
        },
      });
    }

    return {
      success: false,
      error,
      errorCode,
      requestId,
      completedAt: new Date(),
    };
  }

  /**
   * Helper to create a failed withdrawal result AND cache it for idempotency
   * Used for failures after the withdrawal was actually attempted.
   */
  private failWithdrawalAndCache(
    requestId: string,
    userId: string,
    error: string,
    errorCode: string
  ): WithdrawalResult {
    const result = this.failWithdrawal(requestId, userId, error, errorCode);

    // Cache the result for idempotency
    this.requestIdCache.set(requestId, result);

    return result;
  }

  /**
   * Generates a unique request ID
   */
  private generateRequestId(): string {
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Creates a new ExchangeShieldedSDK instance
 *
 * @param config - SDK configuration
 * @returns A new ExchangeShieldedSDK
 */
export function createExchangeSDK(config: SDKConfig): ExchangeShieldedSDK {
  return new ExchangeShieldedSDK(config);
}
