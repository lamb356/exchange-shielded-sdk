/**
 * Storage Interfaces Module
 *
 * Defines pluggable storage adapters for production deployment.
 * The SDK ships with in-memory implementations for development/testing,
 * but production environments should provide Redis, PostgreSQL, or other
 * persistent storage implementations.
 *
 * @packageDocumentation
 */

import { WithdrawalResult, WithdrawalStatus } from '../sdk/exchange-sdk.js';
import { AuditEvent, AuditFilter } from '../compliance/audit-logger.js';

/**
 * User rate limit tracking data
 *
 * Stores the withdrawal counts and amounts for rate limiting.
 * All amounts are in zatoshis (bigint).
 */
export interface UserLimitData {
  /** User identifier */
  userId: string;
  /** Number of withdrawals in the current hour */
  withdrawalsThisHour: number;
  /** Number of withdrawals today */
  withdrawalsToday: number;
  /** Total amount withdrawn today in zatoshis */
  amountToday: bigint;
  /** Timestamp of the last withdrawal (ms since epoch) */
  lastWithdrawalTime: number;
  /** Start of the current hourly window (ms since epoch) */
  hourlyWindowStart: number;
  /** Start of the current daily window (ms since epoch) */
  dailyWindowStart: number;
}

/**
 * Idempotency Store Interface
 *
 * Stores withdrawal results keyed by request ID to prevent double-withdrawals.
 * When a client retries a request with the same request ID, the cached result
 * is returned instead of processing the withdrawal again.
 *
 * PRODUCTION NOTES:
 * - Use Redis with TTL for automatic expiration
 * - Consider using Redis SETNX for atomic operations
 * - Typical TTL: 24-48 hours
 *
 * @example
 * ```typescript
 * // Redis implementation example
 * class RedisIdempotencyStore implements IdempotencyStore {
 *   async get(requestId: string): Promise<WithdrawalResult | null> {
 *     const data = await redis.get(`idempotency:${requestId}`);
 *     return data ? JSON.parse(data, reviver) : null;
 *   }
 *
 *   async set(requestId: string, result: WithdrawalResult, ttlMs?: number): Promise<void> {
 *     const ttl = ttlMs ?? 86400000; // 24 hours default
 *     await redis.set(`idempotency:${requestId}`, JSON.stringify(result, replacer), 'PX', ttl);
 *   }
 * }
 * ```
 */
export interface IdempotencyStore {
  /**
   * Gets a cached withdrawal result by request ID
   *
   * @param requestId - The unique request identifier
   * @returns The cached result, or null if not found
   */
  get(requestId: string): Promise<WithdrawalResult | null>;

  /**
   * Stores a withdrawal result with optional TTL
   *
   * @param requestId - The unique request identifier
   * @param result - The withdrawal result to cache
   * @param ttlMs - Optional time-to-live in milliseconds
   */
  set(requestId: string, result: WithdrawalResult, ttlMs?: number): Promise<void>;

  /**
   * Checks if a request ID exists in the store
   *
   * @param requestId - The unique request identifier
   * @returns True if the request ID exists
   */
  has(requestId: string): Promise<boolean>;

  /**
   * Deletes a cached result
   *
   * @param requestId - The unique request identifier
   * @returns True if the entry was deleted
   */
  delete(requestId: string): Promise<boolean>;
}

/**
 * Rate Limit Store Interface
 *
 * Stores per-user rate limiting data for withdrawal throttling.
 * This data must be shared across all SDK instances in a distributed deployment.
 *
 * PRODUCTION NOTES:
 * - Use Redis for atomic increment operations
 * - Consider using Redis MULTI/EXEC for consistency
 * - Implement sliding window or fixed window algorithms
 *
 * @example
 * ```typescript
 * // Redis implementation example
 * class RedisRateLimitStore implements RateLimitStore {
 *   async getUserLimits(userId: string): Promise<UserLimitData | null> {
 *     const data = await redis.hgetall(`ratelimit:${userId}`);
 *     if (!data || Object.keys(data).length === 0) return null;
 *     return {
 *       userId,
 *       withdrawalsThisHour: parseInt(data.withdrawalsThisHour, 10),
 *       withdrawalsToday: parseInt(data.withdrawalsToday, 10),
 *       amountToday: BigInt(data.amountToday),
 *       lastWithdrawalTime: parseInt(data.lastWithdrawalTime, 10),
 *       hourlyWindowStart: parseInt(data.hourlyWindowStart, 10),
 *       dailyWindowStart: parseInt(data.dailyWindowStart, 10),
 *     };
 *   }
 * }
 * ```
 */
export interface RateLimitStore {
  /**
   * Gets the current rate limit data for a user
   *
   * @param userId - The user identifier
   * @returns The user's limit data, or null if no data exists
   */
  getUserLimits(userId: string): Promise<UserLimitData | null>;

  /**
   * Sets the rate limit data for a user
   *
   * @param userId - The user identifier
   * @param data - The limit data to store
   */
  setUserLimits(userId: string, data: UserLimitData): Promise<void>;

  /**
   * Resets all rate limit data for a user
   *
   * @param userId - The user identifier
   */
  reset(userId: string): Promise<void>;
}

/**
 * Audit Log Sink Interface
 *
 * Persists audit events for compliance and security monitoring.
 * Production deployments should use a durable, queryable storage backend.
 *
 * PRODUCTION NOTES:
 * - Use PostgreSQL with proper indexing for complex queries
 * - Consider time-series databases for high-volume deployments
 * - Implement log rotation and archival policies
 * - Ensure WORM (Write Once Read Many) compliance if required
 *
 * @example
 * ```typescript
 * // PostgreSQL implementation example
 * class PostgresAuditLogSink implements AuditLogSink {
 *   async append(event: AuditEvent): Promise<void> {
 *     await pool.query(
 *       `INSERT INTO audit_events (id, timestamp, event_type, severity, user_id, ...)
 *        VALUES ($1, $2, $3, $4, $5, ...)`,
 *       [event.id, event.timestamp, event.eventType, event.severity, event.userId, ...]
 *     );
 *   }
 *
 *   async query(filter: AuditFilter): Promise<AuditEvent[]> {
 *     // Build SQL query from filter criteria
 *     const { rows } = await pool.query(sql, params);
 *     return rows.map(rowToAuditEvent);
 *   }
 * }
 * ```
 */
export interface AuditLogSink {
  /**
   * Appends an audit event to the log
   *
   * @param event - The audit event to store
   */
  append(event: AuditEvent): Promise<void>;

  /**
   * Queries audit events matching the given filter
   *
   * @param filter - Filter criteria for the query
   * @returns Array of matching audit events
   */
  query(filter: AuditFilter): Promise<AuditEvent[]>;

  /**
   * Gets the hash of the last logged event
   *
   * Used for verifying audit log chain integrity.
   *
   * @returns The hash of the last event, or genesis hash if empty
   */
  getLastHash(): Promise<string>;

  /**
   * Gets the total count of stored audit events
   *
   * @returns The number of events in the store
   */
  count(): Promise<number>;
}

/**
 * Withdrawal Status Store Interface
 *
 * Stores withdrawal status for lifecycle tracking.
 * Enables querying pending withdrawals and tracking confirmation status.
 *
 * PRODUCTION NOTES:
 * - Use Redis for fast status lookups
 * - Consider separate PostgreSQL table for long-term history
 * - Implement status change notifications via pub/sub
 */
export interface WithdrawalStatusStore {
  /**
   * Gets the status of a withdrawal by request ID
   *
   * @param requestId - The unique request identifier
   * @returns The withdrawal status, or null if not found
   */
  get(requestId: string): Promise<WithdrawalStatus | null>;

  /**
   * Gets the status of a withdrawal by transaction ID
   *
   * @param txid - The blockchain transaction ID
   * @returns The withdrawal status, or null if not found
   */
  getByTxid(txid: string): Promise<WithdrawalStatus | null>;

  /**
   * Stores or updates a withdrawal status
   *
   * @param status - The withdrawal status to store
   */
  set(status: WithdrawalStatus): Promise<void>;

  /**
   * Lists all withdrawals with the given status
   *
   * @param status - The status to filter by (e.g., 'pending', 'submitted')
   * @returns Array of withdrawal statuses matching the filter
   */
  listByStatus(status: WithdrawalStatus['status']): Promise<WithdrawalStatus[]>;

  /**
   * Lists all non-confirmed withdrawals (pending, submitted, mempool)
   *
   * @returns Array of pending withdrawal statuses
   */
  listPending(): Promise<WithdrawalStatus[]>;
}
