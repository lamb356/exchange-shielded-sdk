/**
 * Storage Module
 *
 * Pluggable storage adapters for production deployment.
 * Includes interfaces for implementing custom storage backends
 * and in-memory implementations for development/testing.
 *
 * @packageDocumentation
 */

// =============================================================================
// Interface exports
// =============================================================================
export type {
  UserLimitData,
  IdempotencyStore,
  RateLimitStore,
  AuditLogSink,
  WithdrawalStatusStore,
} from './interfaces.js';

// =============================================================================
// In-memory implementation exports
// =============================================================================
export {
  MemoryIdempotencyStore,
  MemoryRateLimitStore,
  MemoryAuditLogSink,
  MemoryWithdrawalStatusStore,
  createMemoryStores,
} from './memory.js';
