/**
 * Utilities Module
 *
 * @packageDocumentation
 */

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
} from './amounts.js';

export {
  LogLevel,
  Logger,
  createLogger,
  defaultLogger,
} from './logger.js';

export type {
  LogEntry,
  LoggerConfig,
} from './logger.js';
