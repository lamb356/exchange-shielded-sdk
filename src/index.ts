/**
 * Exchange Shielded Withdrawal SDK
 *
 * A TypeScript SDK for validating Zcash addresses, building shielded transactions,
 * and managing security/compliance for exchange withdrawals.
 *
 * @packageDocumentation
 */

// =============================================================================
// Address Validator exports
// =============================================================================
export {
  validateAddress,
  isShielded,
  parseUnifiedAddress,
  validateAddressDetailed,
  getAddressPrefixes,
  setValidationOptions,
  resetValidationOptions,
} from './address-validator.js';

export type {
  AddressType,
  UnifiedAddressComponents,
  AddressValidationResult,
  AddressValidationOptions,
} from './address-validator.js';

// =============================================================================
// Transaction Builder exports
// =============================================================================
export {
  ShieldedTransactionBuilder,
  TransactionBuilderError,
  ZIP317,
  calculateTransparentActions,
  calculateSaplingActions,
  calculateOrchardActions,
  calculateLogicalActions,
  calculateConventionalFee,
  estimateTransactionFee,
} from './transaction-builder.js';

export type {
  PendingTransaction,
  UnsignedTransaction,
  TransactionInput,
  TransactionOutput,
  ZAmount,
  ZSendmanyRequest,
  PrivacyPolicy,
  FeeEstimateOptions,
  FeeEstimate,
} from './transaction-builder.js';

// =============================================================================
// RPC Client exports
// =============================================================================
export {
  ZcashRpcClient,
  RpcError,
  OperationTimeoutError,
  createRpcClient,
} from './rpc-client.js';

export type {
  RpcAuth,
  RpcConfig,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  UnspentNote,
  TotalBalance,
  OperationStatusValue,
  OperationStatus,
  OperationResult,
  FetchFunction,
} from './rpc-client.js';

// =============================================================================
// Utilities exports
// =============================================================================
export {
  ZATOSHIS_PER_ZEC,
  MAX_ZATOSHIS,
  MIN_ZATOSHIS,
  AmountError,
  zecToZatoshis,
  zatoshisToZec,
  validateZatoshis,
  validatePositiveZatoshis,
  formatZatoshis,
  parseAmountToZatoshis,
  addZatoshis,
  subtractZatoshis,
} from './utils/index.js';

// =============================================================================
// Security exports
// =============================================================================
export {
  // Key Manager
  SecureKeyManager,
  KeyManagerError,
  createKeyManager,
  // Sanitizer
  ValidationError,
  sanitizeAddress,
  sanitizeAmount,
  sanitizeMemo,
  sanitizeUserId,
  sanitizeTransactionId,
  textToMemoHex,
  memoHexToText,
  redactSensitiveData,
  // Rate Limiter
  WithdrawalRateLimiter,
  createRateLimiter,
  createConservativeRateLimiter,
  createHighVolumeRateLimiter,
} from './security/index.js';

export type {
  SpendingKey,
  KeyManagerConfig,
  SigningResult,
  SanitizedAddress,
  SanitizedAmount,
  SanitizedMemo,
  RedactionConfig,
  RateLimitConfig,
  RateLimitResult,
  RateLimitUsage,
  RemainingLimit,
} from './security/index.js';

// =============================================================================
// Compliance exports
// =============================================================================
export {
  // Audit Logger
  AuditLogger,
  AuditEventType,
  AuditSeverity,
  createAuditLogger,
  getDefaultSeverity,
  // Compliance Manager
  ComplianceManager,
  createComplianceManager,
} from './compliance/index.js';

export type {
  AuditEvent,
  AuditFilter,
  ComplianceReport,
  AuditConfig,
  DateRange,
  ViewingKeyExport,
  ViewingKeyBundle,
  VelocityCheckResult,
  SuspiciousActivityFlag,
  VelocityThresholds,
  ComplianceConfig,
} from './compliance/index.js';

// =============================================================================
// SDK exports
// =============================================================================
export {
  ExchangeShieldedSDK,
  createExchangeSDK,
} from './sdk/index.js';

export type {
  SDKConfig,
  WithdrawalRequest,
  WithdrawalResult,
  WithdrawalStatus,
  FeeEstimate as SDKFeeEstimate,
} from './sdk/index.js';
