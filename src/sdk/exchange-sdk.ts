/**
 * Exchange Shielded SDK
 *
 * High-level SDK wrapper for exchange integration with shielded withdrawals.
 * Provides a unified API that combines transaction building, RPC communication,
 * security, and compliance features.
 *
 * IMPORTANT: Core methods use bigint internally; external integrations should
 * use the DTO boundary methods (processWithdrawalDTO, getWithdrawalStatusDTO, etc.)
 * which accept/return string amounts for JSON safety.
 *
 * 1 ZEC = 100_000_000 zatoshis (10^8)
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
import { isShielded } from '../address-validator.js';
import { zatoshisToZec, validatePositiveZatoshis } from '../utils/amounts.js';
import { Logger, LogLevel } from '../utils/logger.js';
import {
  IdempotencyStore,
  WithdrawalStatusStore,
  RateLimitStore,
  MemoryIdempotencyStore,
  MemoryWithdrawalStatusStore,
} from '../storage/index.js';
import {
  WithdrawalRequestDTO,
  WithdrawalResultDTO,
  WithdrawalStatusDTO,
  toWithdrawalResultDTO,
  fromWithdrawalRequestDTO,
  toWithdrawalStatusDTO,
} from '../types/dto.js';

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
  /**
   * Custom idempotency store for production deployment
   * If not provided, uses in-memory storage (not suitable for production)
   */
  idempotencyStore?: IdempotencyStore;
  /**
   * Custom withdrawal status store for production deployment
   * If not provided, uses in-memory storage (not suitable for production)
   */
  withdrawalStatusStore?: WithdrawalStatusStore;
  /**
   * Custom rate limit store for distributed rate limiting
   * If not provided, uses in-memory storage (not suitable for distributed deployments)
   */
  rateLimitStore?: RateLimitStore;
}

/**
 * Withdrawal request
 *
 * All amounts are in zatoshis (1 ZEC = 100_000_000 zatoshis).
 */
export interface WithdrawalRequest {
  /** User ID making the request */
  userId: string;
  /** Source address (shielded) */
  fromAddress: string;
  /** Destination address */
  toAddress: string;
  /** Amount in zatoshis (1 ZEC = 100_000_000n zatoshis) */
  amount: bigint;
  /** Optional memo (for shielded recipients) */
  memo?: string;
  /** Optional request ID for tracking */
  requestId?: string;
}

/**
 * Withdrawal result
 *
 * All amounts are in zatoshis (1 ZEC = 100_000_000 zatoshis).
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
  /** Fee paid in zatoshis (1 ZEC = 100_000_000n zatoshis) */
  fee?: bigint;
  /** Request ID from the original request */
  requestId?: string;
  /** Timestamp of completion */
  completedAt?: Date;
}

/**
 * Withdrawal status
 *
 * Tracks the lifecycle of a withdrawal from initial request to final confirmation.
 * Status progresses: pending -> submitted -> mempool -> confirmed (or failed at any stage)
 */
export interface WithdrawalStatus {
  /** Request ID that initiated this withdrawal */
  requestId: string;
  /** Current status in the lifecycle */
  status: 'pending' | 'submitted' | 'mempool' | 'confirmed' | 'failed' | 'unknown';
  /** Transaction ID if available (after submission) */
  txid?: string;
  /** Number of confirmations (for mempool/confirmed status) */
  confirmations?: number;
  /** Block height where transaction was mined */
  blockHeight?: number;
  /** Error message if failed */
  error?: string;
  /** When the withdrawal was first created */
  createdAt: Date;
  /** When the status was last updated */
  updatedAt: Date;
}

/**
 * Fee estimate
 *
 * All amounts are in zatoshis (1 ZEC = 100_000_000 zatoshis).
 */
export interface FeeEstimate {
  /** Estimated fee in zatoshis (1 ZEC = 100_000_000n zatoshis) */
  feeZatoshis: bigint;
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
 * IMPORTANT: All monetary amounts are in zatoshis (bigint).
 * 1 ZEC = 100_000_000 zatoshis (10^8)
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
 * // Process a withdrawal (amount in zatoshis: 10.5 ZEC = 1_050_000_000n)
 * const result = await sdk.processWithdrawal({
 *   userId: 'user-123',
 *   fromAddress: 'zs1source...',
 *   toAddress: 'zs1dest...',
 *   amount: 1_050_000_000n // 10.5 ZEC in zatoshis
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

  /** Structured logger */
  private readonly logger: Logger;

  /** Pending operations tracking */
  private readonly pendingOperations: Map<string, { userId: string; requestId?: string }>;

  /**
   * Idempotency store for preventing double-withdrawals
   *
   * SECURITY: Prevents double-withdrawals when clients retry failed requests.
   * If a requestId has already been processed, the cached result is returned
   * instead of processing the withdrawal again.
   *
   * WARNING: In-memory by default - provide custom store for production.
   */
  private readonly idempotencyStore: IdempotencyStore;

  /**
   * Withdrawal status store for lifecycle tracking
   *
   * Tracks withdrawal status from pending through confirmation.
   *
   * WARNING: In-memory by default - provide custom store for production.
   */
  private readonly withdrawalStatusStore: WithdrawalStatusStore;

  /**
   * Creates a new ExchangeShieldedSDK
   *
   * @param config - SDK configuration
   */
  constructor(config: SDKConfig) {
    this.config = config;

    // Initialize structured logger
    this.logger = new Logger({ level: LogLevel.INFO, prefix: 'SDK' });

    // Initialize RPC client
    this.rpcClient = new ZcashRpcClient(config.rpc);

    // Initialize transaction builder
    this.txBuilder = new ShieldedTransactionBuilder({
      minconf: config.minconf ?? 10,
      privacyPolicy: config.privacyPolicy ?? 'FullPrivacy',
    });

    // Initialize security components
    this.keyManager = new SecureKeyManager(config.keyManager);
    // Pass the rate limit store to the rate limiter if provided
    this.rateLimiter = new WithdrawalRateLimiter({
      ...config.rateLimiter,
      store: config.rateLimitStore,
    });

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

    // Initialize storage (use provided stores or default to in-memory)
    // WARNING: In-memory storage is NOT suitable for production
    this.idempotencyStore = config.idempotencyStore ?? new MemoryIdempotencyStore();
    this.withdrawalStatusStore = config.withdrawalStatusStore ?? new MemoryWithdrawalStatusStore();
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
    const cachedResult = await this.idempotencyStore.get(requestId);
    if (cachedResult !== null) {
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

    // Create initial pending status
    const now = new Date();
    await this.withdrawalStatusStore.set({
      requestId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    try {
      // Validate and sanitize inputs first
      const fromResult = sanitizeAddress(request.fromAddress);
      if (!fromResult.valid) {
        return this.failWithdrawal(
          requestId,
          request.userId,
          fromResult.error ?? 'Invalid source address',
          'INVALID_FROM_ADDRESS'
        );
      }

      // SECURITY: Validate that fromAddress is shielded UPFRONT
      // This provides a clear error instead of failing deep in the transaction builder
      if (!isShielded(fromResult.address)) {
        return this.failWithdrawal(
          requestId,
          request.userId,
          'Source address must be shielded (zs/u1)',
          'FROM_ADDRESS_NOT_SHIELDED'
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

      // Validate the amount (bigint zatoshis)
      try {
        validatePositiveZatoshis(request.amount);
      } catch (amountError) {
        return this.failWithdrawal(
          requestId,
          request.userId,
          amountError instanceof Error ? amountError.message : 'Invalid amount',
          'INVALID_AMOUNT'
        );
      }

      // Convert zatoshis to ZEC for internal processing and logging
      const amountZec = zatoshisToZec(request.amount);

      // Log withdrawal request (after validation, using converted ZEC for display)
      if (this.config.enableAuditLogging !== false) {
        this.auditLogger.log({
          eventType: AuditEventType.WITHDRAWAL_REQUESTED,
          severity: AuditSeverity.INFO,
          userId: request.userId,
          amount: amountZec,
          destinationAddress: request.toAddress,
          metadata: {
            requestId,
            fromAddress: request.fromAddress,
            amountZatoshis: String(request.amount),
          },
        });
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

      // Check rate limits (using bigint amount)
      const rateLimitResult = this.rateLimiter.checkLimit(request.userId, request.amount);
      if (!rateLimitResult.allowed) {
        if (this.config.enableAuditLogging !== false) {
          this.auditLogger.log({
            eventType: AuditEventType.RATE_LIMIT_HIT,
            severity: AuditSeverity.WARNING,
            userId: request.userId,
            amount: amountZec, // Audit logger still uses ZEC for display
            metadata: {
              requestId,
              reason: rateLimitResult.reason,
              usage: rateLimitResult.usage,
            },
          });
        }

        // Cache rate limit failures for idempotency (prevents repeated rate limit checks on retry)
        return await this.failWithdrawalAndCache(
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
          request.amount
        );

        if (!velocityResult.passed) {
          this.complianceManager.flagSuspiciousActivity(
            request.userId,
            velocityResult.reason ?? 'Velocity check failed',
            { requestId, amountZatoshis: String(request.amount) }
          );

          // Cache velocity failures for idempotency
          return await this.failWithdrawalAndCache(
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
          amount: amountZec, // Audit logger uses ZEC for display
          destinationAddress: toResult.address,
          metadata: { requestId },
        });
      }

      // Build the transaction - pass zatoshis directly (bigint)
      const pendingTx = this.txBuilder.buildShieldedWithdrawal(
        fromResult.address,
        toResult.address,
        request.amount, // Pass zatoshis (bigint) directly
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

      // Record the withdrawal (using bigint amount)
      this.rateLimiter.recordWithdrawal(request.userId, request.amount);

      if (this.config.enableCompliance !== false) {
        this.complianceManager.recordTransaction(request.userId, request.amount);
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
            amount: amountZec, // Audit logger uses ZEC for display
            destinationAddress: toResult.address,
            metadata: {
              requestId,
              operationId,
              executionTime: result.execution_secs,
            },
          });
        }

        // Convert fee from ZEC string to zatoshis for the result
        const feeZatoshis = zsendmanyRequest.fee !== null
          ? BigInt(Math.round(parseFloat(zsendmanyRequest.fee) * 100_000_000))
          : undefined;

        const completedAt = new Date();
        const successResult: WithdrawalResult = {
          success: true,
          transactionId: result.result.txid,
          operationId,
          fee: feeZatoshis,
          requestId,
          completedAt,
        };

        // Cache the result for idempotency
        await this.idempotencyStore.set(requestId, successResult);

        // Update withdrawal status to submitted (will be updated to confirmed by refresh)
        await this.withdrawalStatusStore.set({
          requestId,
          status: 'submitted',
          txid: result.result.txid,
          createdAt: completedAt,
          updatedAt: completedAt,
        });

        return successResult;
      } else {
        const errorMessage = result.error?.message ?? 'Transaction failed';
        return await this.failWithdrawalAndCache(requestId, request.userId, errorMessage, 'TX_FAILED');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Log with redacted error using structured logger
      this.logger.error('Withdrawal failed', redactSensitiveData({ error: errorMessage }) as Record<string, unknown>);

      return await this.failWithdrawalAndCache(requestId, request.userId, errorMessage, 'INTERNAL_ERROR');
    }
  }

  /**
   * Gets the status of a withdrawal by request ID
   *
   * @param requestId - The request ID
   * @returns The withdrawal status, or null if not found
   */
  async getWithdrawalStatus(requestId: string): Promise<WithdrawalStatus | null> {
    // Check in withdrawal status store
    const status = await this.withdrawalStatusStore.get(requestId);
    if (status) {
      return status;
    }

    // Fall back to idempotency cache for basic info
    const cachedResult = await this.idempotencyStore.get(requestId);
    if (cachedResult) {
      const now = new Date();
      return {
        requestId,
        status: cachedResult.success ? 'confirmed' : 'failed',
        txid: cachedResult.transactionId,
        error: cachedResult.error,
        createdAt: cachedResult.completedAt ?? now,
        updatedAt: now,
      };
    }

    return null;
  }

  /**
   * Refreshes the status of a withdrawal by querying zcashd
   *
   * This queries the blockchain for the current transaction status,
   * including confirmation count and block height.
   *
   * @param requestId - The request ID
   * @returns Updated withdrawal status, or null if not found
   */
  async refreshWithdrawalStatus(requestId: string): Promise<WithdrawalStatus | null> {
    const status = await this.getWithdrawalStatus(requestId);
    if (!status || !status.txid) {
      return status;
    }

    try {
      // Query transaction from zcashd
      // gettransaction returns: { confirmations, blockheight, ... }
      interface TransactionInfo {
        confirmations?: number;
        blockheight?: number;
      }
      const txInfo = await this.rpcClient.call<TransactionInfo>('gettransaction', [status.txid]);

      const now = new Date();
      const confirmations = typeof txInfo.confirmations === 'number' ? txInfo.confirmations : 0;

      let newStatus: WithdrawalStatus['status'];
      if (confirmations === 0) {
        newStatus = 'mempool';
      } else if (confirmations > 0) {
        newStatus = 'confirmed';
      } else {
        newStatus = 'unknown';
      }

      const updatedStatus: WithdrawalStatus = {
        requestId,
        status: newStatus,
        txid: status.txid,
        confirmations,
        blockHeight: typeof txInfo.blockheight === 'number' ? txInfo.blockheight : undefined,
        createdAt: status.createdAt,
        updatedAt: now,
      };

      // Update the status store
      await this.withdrawalStatusStore.set(updatedStatus);

      return updatedStatus;
    } catch (error) {
      // Transaction might not be found (reorg, etc.)
      this.logger.warn('Failed to refresh withdrawal status', {
        requestId,
        txid: status.txid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return status;
    }
  }

  /**
   * Lists all pending (non-confirmed) withdrawals
   *
   * Returns withdrawals with status: pending, submitted, or mempool
   *
   * @returns Array of pending withdrawal statuses
   */
  async listPendingWithdrawals(): Promise<WithdrawalStatus[]> {
    return this.withdrawalStatusStore.listPending();
  }

  /**
   * Gets a withdrawal status by transaction ID
   *
   * @param txid - The blockchain transaction ID
   * @returns The withdrawal status, or null if not found
   */
  async getWithdrawalByTxid(txid: string): Promise<WithdrawalStatus | null> {
    return this.withdrawalStatusStore.getByTxid(txid);
  }

  // ===========================================================================
  // DTO Boundary Methods
  // These methods provide JSON-safe entry/exit points for external integrations
  // ===========================================================================

  /**
   * Process withdrawal with DTO boundary enforcement
   * This is the recommended entry point for external integrations
   *
   * @param request - External withdrawal request DTO (string amounts)
   * @returns Withdrawal result DTO (string amounts, JSON-safe)
   */
  async processWithdrawalDTO(request: WithdrawalRequestDTO): Promise<WithdrawalResultDTO> {
    const internalRequest = fromWithdrawalRequestDTO(request);
    const result = await this.processWithdrawal(internalRequest);
    return toWithdrawalResultDTO(result);
  }

  /**
   * Get withdrawal status with DTO boundary
   *
   * @param requestId - The request ID
   * @returns Withdrawal status DTO, or null if not found or unknown
   */
  async getWithdrawalStatusDTO(requestId: string): Promise<WithdrawalStatusDTO | null> {
    const status = await this.getWithdrawalStatus(requestId);
    if (!status || status.status === 'unknown') return null;
    return toWithdrawalStatusDTO(status);
  }

  /**
   * List pending withdrawals with DTO boundary
   *
   * @returns Array of pending withdrawal status DTOs
   */
  async listPendingWithdrawalsDTO(): Promise<WithdrawalStatusDTO[]> {
    const statuses = await this.listPendingWithdrawals();
    return statuses.map(toWithdrawalStatusDTO);
  }

  /**
   * Get withdrawal by txid with DTO boundary
   *
   * @param txid - The blockchain transaction ID
   * @returns Withdrawal status DTO, or null if not found
   */
  async getWithdrawalByTxidDTO(txid: string): Promise<WithdrawalStatusDTO | null> {
    const status = await this.getWithdrawalByTxid(txid);
    if (!status) return null;
    return toWithdrawalStatusDTO(status);
  }

  /**
   * Refresh withdrawal status with DTO boundary
   *
   * @param requestId - The request ID
   * @returns Updated withdrawal status DTO, or null if not found or unknown
   */
  async refreshWithdrawalStatusDTO(requestId: string): Promise<WithdrawalStatusDTO | null> {
    const status = await this.refreshWithdrawalStatus(requestId);
    if (!status || status.status === 'unknown') return null;
    return toWithdrawalStatusDTO(status);
  }

  /**
   * Estimates the fee for a withdrawal
   *
   * @param amountZatoshis - The withdrawal amount in zatoshis
   * @param destination - The destination address
   * @returns Fee estimate (fee in zatoshis)
   */
  async estimateWithdrawalFee(amountZatoshis: bigint, destination: string): Promise<FeeEstimate> {
    // Validate destination
    const destResult = sanitizeAddress(destination);
    if (!destResult.valid) {
      throw new Error(`Invalid destination address: ${destResult.error}`);
    }

    // Validate amount
    validatePositiveZatoshis(amountZatoshis);

    // Build a dummy transaction for estimation
    // Using a placeholder source address
    const placeholderSource = 'zs1placeholder' + '0'.repeat(60);

    try {
      const pendingTx: PendingTransaction = {
        from: placeholderSource,
        to: destResult.address,
        amount: amountZatoshis, // Now uses zatoshis directly (bigint)
        createdAt: Date.now(),
        fromType: 'sapling',
        toType: destResult.type,
      };

      // estimateFee now returns bigint (zatoshis)
      const feeZatoshis = await this.txBuilder.estimateFee(pendingTx);

      return {
        feeZatoshis,
        logicalActions: Math.ceil(Number(feeZatoshis) / 5000), // Approximate from fee
        isApproximate: true,
      };
    } catch {
      // Return minimum fee as fallback
      return {
        feeZatoshis: 10000n,
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
   * @param amountZatoshis - The amount in zatoshis to check
   * @returns Rate limit check result
   */
  checkRateLimit(userId: string, amountZatoshis: bigint): RateLimitResult {
    return this.rateLimiter.checkLimit(userId, amountZatoshis);
  }

  /**
   * Checks velocity for a user
   *
   * @param userId - The user ID
   * @param amountZatoshis - The amount in zatoshis to check
   * @returns Velocity check result
   */
  checkVelocity(userId: string, amountZatoshis: bigint): VelocityCheckResult {
    return this.complianceManager.checkVelocity(userId, amountZatoshis);
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
  private async failWithdrawalAndCache(
    requestId: string,
    userId: string,
    error: string,
    errorCode: string
  ): Promise<WithdrawalResult> {
    const result = this.failWithdrawal(requestId, userId, error, errorCode);

    // Cache the result for idempotency
    await this.idempotencyStore.set(requestId, result);

    // Update withdrawal status to failed
    await this.withdrawalStatusStore.set({
      requestId,
      status: 'failed',
      error,
      createdAt: result.completedAt ?? new Date(),
      updatedAt: result.completedAt ?? new Date(),
    });

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
