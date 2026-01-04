/**
 * In-Memory Storage Implementations
 *
 * Development and testing implementations of the storage interfaces.
 * These are NOT suitable for production use as they:
 * - Do not persist data across restarts
 * - Do not support horizontal scaling
 * - Have no TTL enforcement (except via periodic cleanup)
 *
 * For production, implement the interfaces with Redis, PostgreSQL, etc.
 *
 * @packageDocumentation
 */

import { WithdrawalResult, WithdrawalStatus } from '../sdk/exchange-sdk.js';
import { AuditEvent, AuditFilter, AuditSeverity } from '../compliance/audit-logger.js';
import {
  IdempotencyStore,
  RateLimitStore,
  AuditLogSink,
  WithdrawalStatusStore,
  UserLimitData,
} from './interfaces.js';

/**
 * Genesis hash for empty audit log chains
 */
const GENESIS_HASH = '0'.repeat(64);

/**
 * Severity ordering for filtering
 */
const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  [AuditSeverity.DEBUG]: 0,
  [AuditSeverity.INFO]: 1,
  [AuditSeverity.WARNING]: 2,
  [AuditSeverity.ERROR]: 3,
  [AuditSeverity.CRITICAL]: 4,
};

/**
 * Entry with expiration tracking
 */
interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

/**
 * In-Memory Idempotency Store
 *
 * WARNING: This implementation is for development/testing only.
 * - Data is lost on process restart
 * - Not suitable for distributed deployments
 * - TTL cleanup only happens on access
 *
 * @example
 * ```typescript
 * const store = new MemoryIdempotencyStore();
 *
 * // Store a result with 1-hour TTL
 * await store.set('req-123', result, 3600000);
 *
 * // Check if request was already processed
 * if (await store.has('req-123')) {
 *   return await store.get('req-123');
 * }
 * ```
 */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly cache: Map<string, CacheEntry<WithdrawalResult>>;

  constructor() {
    this.cache = new Map();
  }

  async get(requestId: string): Promise<WithdrawalResult | null> {
    const entry = this.cache.get(requestId);
    if (!entry) {
      return null;
    }

    // Check expiration
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.cache.delete(requestId);
      return null;
    }

    return entry.value;
  }

  async set(requestId: string, result: WithdrawalResult, ttlMs?: number): Promise<void> {
    const entry: CacheEntry<WithdrawalResult> = {
      value: result,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : undefined,
    };
    this.cache.set(requestId, entry);
  }

  async has(requestId: string): Promise<boolean> {
    const result = await this.get(requestId);
    return result !== null;
  }

  async delete(requestId: string): Promise<boolean> {
    return this.cache.delete(requestId);
  }

  /**
   * Gets the number of entries in the store (for testing)
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clears all entries (for testing)
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Removes expired entries (for testing/maintenance)
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== undefined && now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

/**
 * In-Memory Rate Limit Store
 *
 * WARNING: This implementation is for development/testing only.
 * - Data is lost on process restart
 * - Not suitable for distributed deployments
 * - No automatic window rotation
 *
 * @example
 * ```typescript
 * const store = new MemoryRateLimitStore();
 *
 * // Get user's current limits
 * const limits = await store.getUserLimits('user-123');
 * if (limits && limits.withdrawalsThisHour >= 10) {
 *   throw new Error('Hourly limit exceeded');
 * }
 *
 * // Update limits after withdrawal
 * await store.setUserLimits('user-123', {
 *   ...limits,
 *   withdrawalsThisHour: (limits?.withdrawalsThisHour ?? 0) + 1,
 * });
 * ```
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly limits: Map<string, UserLimitData>;

  constructor() {
    this.limits = new Map();
  }

  async getUserLimits(userId: string): Promise<UserLimitData | null> {
    return this.limits.get(userId) ?? null;
  }

  async setUserLimits(userId: string, data: UserLimitData): Promise<void> {
    this.limits.set(userId, data);
  }

  async reset(userId: string): Promise<void> {
    this.limits.delete(userId);
  }

  /**
   * Gets the number of tracked users (for testing)
   */
  size(): number {
    return this.limits.size;
  }

  /**
   * Clears all entries (for testing)
   */
  clear(): void {
    this.limits.clear();
  }

  /**
   * Gets all user IDs with stored limits (for testing)
   */
  getUserIds(): string[] {
    return Array.from(this.limits.keys());
  }
}

/**
 * In-Memory Audit Log Sink
 *
 * WARNING: This implementation is for development/testing only.
 * - Data is lost on process restart
 * - Not suitable for compliance requirements
 * - No persistence or replication
 *
 * @example
 * ```typescript
 * const sink = new MemoryAuditLogSink();
 *
 * // Append an event
 * await sink.append(auditEvent);
 *
 * // Query events
 * const events = await sink.query({
 *   eventTypes: [AuditEventType.WITHDRAWAL_COMPLETED],
 *   startDate: new Date('2024-01-01'),
 * });
 * ```
 */
export class MemoryAuditLogSink implements AuditLogSink {
  private readonly events: AuditEvent[];
  private readonly maxEvents: number;

  constructor(maxEvents: number = 100000) {
    this.events = [];
    this.maxEvents = maxEvents;
  }

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);

    // Enforce max events limit
    while (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  async query(filter: AuditFilter): Promise<AuditEvent[]> {
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

  async getLastHash(): Promise<string> {
    if (this.events.length === 0) {
      return GENESIS_HASH;
    }
    const lastEvent = this.events[this.events.length - 1];
    return lastEvent?.hash ?? GENESIS_HASH;
  }

  async count(): Promise<number> {
    return this.events.length;
  }

  /**
   * Clears all events (for testing)
   */
  clear(): void {
    this.events.length = 0;
  }

  /**
   * Gets all events (for testing)
   */
  getAll(): AuditEvent[] {
    return [...this.events];
  }
}

/**
 * In-Memory Withdrawal Status Store
 *
 * WARNING: This implementation is for development/testing only.
 * - Data is lost on process restart
 * - Not suitable for distributed deployments
 *
 * @example
 * ```typescript
 * const store = new MemoryWithdrawalStatusStore();
 *
 * // Store a status
 * await store.set({
 *   requestId: 'req-123',
 *   status: 'submitted',
 *   txid: 'abc123...',
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * });
 *
 * // List pending withdrawals
 * const pending = await store.listPending();
 * ```
 */
export class MemoryWithdrawalStatusStore implements WithdrawalStatusStore {
  private readonly byRequestId: Map<string, WithdrawalStatus>;
  private readonly byTxid: Map<string, string>; // txid -> requestId

  constructor() {
    this.byRequestId = new Map();
    this.byTxid = new Map();
  }

  async get(requestId: string): Promise<WithdrawalStatus | null> {
    return this.byRequestId.get(requestId) ?? null;
  }

  async getByTxid(txid: string): Promise<WithdrawalStatus | null> {
    const requestId = this.byTxid.get(txid);
    if (!requestId) {
      return null;
    }
    return this.byRequestId.get(requestId) ?? null;
  }

  async set(status: WithdrawalStatus): Promise<void> {
    this.byRequestId.set(status.requestId, status);
    if (status.txid) {
      this.byTxid.set(status.txid, status.requestId);
    }
  }

  async listByStatus(status: WithdrawalStatus['status']): Promise<WithdrawalStatus[]> {
    const results: WithdrawalStatus[] = [];
    for (const ws of this.byRequestId.values()) {
      if (ws.status === status) {
        results.push(ws);
      }
    }
    return results;
  }

  async listPending(): Promise<WithdrawalStatus[]> {
    const pendingStatuses = new Set(['pending', 'submitted', 'mempool']);
    const results: WithdrawalStatus[] = [];
    for (const ws of this.byRequestId.values()) {
      if (pendingStatuses.has(ws.status)) {
        results.push(ws);
      }
    }
    return results;
  }

  /**
   * Gets the number of tracked withdrawals (for testing)
   */
  size(): number {
    return this.byRequestId.size;
  }

  /**
   * Clears all entries (for testing)
   */
  clear(): void {
    this.byRequestId.clear();
    this.byTxid.clear();
  }
}

/**
 * Creates default in-memory storage instances
 *
 * WARNING: These are for development/testing only.
 * Production deployments should provide persistent storage implementations.
 *
 * @returns Object containing all memory store instances
 */
export function createMemoryStores(): {
  idempotencyStore: MemoryIdempotencyStore;
  rateLimitStore: MemoryRateLimitStore;
  auditLogSink: MemoryAuditLogSink;
  withdrawalStatusStore: MemoryWithdrawalStatusStore;
} {
  return {
    idempotencyStore: new MemoryIdempotencyStore(),
    rateLimitStore: new MemoryRateLimitStore(),
    auditLogSink: new MemoryAuditLogSink(),
    withdrawalStatusStore: new MemoryWithdrawalStatusStore(),
  };
}
