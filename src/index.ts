/**
 * Exchange Shielded Withdrawal SDK
 *
 * A TypeScript SDK for validating Zcash addresses and building shielded transactions.
 * Supports transparent, Sprout, Sapling, and Unified address formats.
 *
 * @packageDocumentation
 */

// Address Validator exports
export {
  validateAddress,
  isShielded,
  parseUnifiedAddress,
  validateAddressDetailed,
  getAddressPrefixes,
} from './address-validator.js';

export type {
  AddressType,
  UnifiedAddressComponents,
  AddressValidationResult,
} from './address-validator.js';

// Transaction Builder exports
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

// RPC Client exports
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
