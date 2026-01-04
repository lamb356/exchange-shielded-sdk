/**
 * SDK Module
 *
 * Exports the high-level Exchange Shielded SDK.
 *
 * @packageDocumentation
 */

export {
  ExchangeShieldedSDK,
  createExchangeSDK,
} from './exchange-sdk.js';

export type {
  SDKConfig,
  WithdrawalRequest,
  WithdrawalResult,
  WithdrawalStatus,
  FeeEstimate,
} from './exchange-sdk.js';
