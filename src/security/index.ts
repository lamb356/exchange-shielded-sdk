/**
 * Security Module
 *
 * Exports all security-related functionality including key management,
 * input sanitization, and rate limiting.
 *
 * @packageDocumentation
 */

// Key Manager exports
export {
  SecureKeyManager,
  KeyManagerError,
  createKeyManager,
} from './key-manager.js';

export type {
  SpendingKey,
  KeyManagerConfig,
  SigningResult,
} from './key-manager.js';

// Sanitizer exports
export {
  ValidationError,
  sanitizeAddress,
  sanitizeAmount,
  sanitizeMemo,
  sanitizeUserId,
  sanitizeTransactionId,
  textToMemoHex,
  memoHexToText,
  redactSensitiveData,
} from './sanitizer.js';

export type {
  SanitizedAddress,
  SanitizedAmount,
  SanitizedMemo,
  RedactionConfig,
} from './sanitizer.js';

// Rate Limiter exports
export {
  WithdrawalRateLimiter,
  createRateLimiter,
  createConservativeRateLimiter,
  createHighVolumeRateLimiter,
} from './rate-limiter.js';

export type {
  RateLimitConfig,
  RateLimitResult,
  RateLimitUsage,
  RemainingLimit,
} from './rate-limiter.js';
