/**
 * Exchange Shielded Withdrawal SDK
 *
 * A TypeScript SDK for validating Zcash addresses, supporting transparent,
 * Sprout, Sapling, and Unified address formats.
 *
 * @packageDocumentation
 */

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
