/**
 * Types Module
 *
 * @packageDocumentation
 */

export {
  zatoshi,
  zecToZatoshi,
  zatoshiToZec,
  zatoshiToString,
  stringToZatoshi,
  ONE_ZEC,
  MAX_SUPPLY,
} from './money.js';

export type {
  Zatoshi,
  ZatoshiString,
} from './money.js';

// DTO types and converters
export {
  toWithdrawalResultDTO,
  fromWithdrawalRequestDTO,
  toWithdrawalStatusDTO,
} from './dto.js';

export type {
  WithdrawalRequestDTO,
  WithdrawalResultDTO,
  WithdrawalStatusDTO,
} from './dto.js';
