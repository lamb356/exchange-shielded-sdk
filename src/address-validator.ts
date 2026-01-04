/**
 * Address Validator Module for Zcash addresses
 *
 * Supports validation of:
 * - Transparent addresses (t1/t3): Base58Check encoded with checksum validation
 * - Sprout addresses (zc): Base58Check encoded with checksum validation (legacy shielded)
 * - Sapling addresses (zs): Bech32 encoded with checksum validation
 * - Unified addresses (u1): Bech32m encoded with checksum validation (may contain multiple receivers)
 *
 * Uses bs58check for Base58Check validation and bech32 for Bech32/Bech32m validation.
 */

import bs58check from 'bs58check';
import { bech32, bech32m } from 'bech32';

/**
 * Types of Zcash addresses
 */
export type AddressType =
  | 'transparent'
  | 'sprout'
  | 'sapling'
  | 'orchard'
  | 'unified'
  | 'unknown';

/**
 * Components that may be present in a Unified Address
 *
 * WARNING: Full UA decoding requires librustzcash WASM bindings.
 * Currently we can only confirm the address is valid Bech32m, not which receivers it contains.
 */
export interface UnifiedAddressComponents {
  /** Whether this is a valid unified address */
  unified?: boolean;
  /** Receiver types are unknown without librustzcash - do not assume Orchard presence */
  receivers?: 'unknown';
  /** Transparent (P2PKH or P2SH) receiver address if present */
  transparent?: string;
  /** Sapling receiver address if present */
  sapling?: string;
}

/**
 * Result of address validation with detailed information
 */
export interface AddressValidationResult {
  /** Whether the address is valid */
  valid: boolean;
  /** The detected address type */
  type: AddressType;
  /** Whether the address is shielded (privacy-preserving) */
  shielded: boolean;
  /** Network the address belongs to */
  network: 'mainnet' | 'testnet' | 'unknown';
  /** Error message if validation failed */
  error?: string;
}

/**
 * Address format specifications
 */
const ADDRESS_FORMATS = {
  TRANSPARENT_P2PKH: { prefix: 't1', length: 35, network: 'mainnet' as const },
  TRANSPARENT_P2SH: { prefix: 't3', length: 35, network: 'mainnet' as const },
  TRANSPARENT_P2PKH_TESTNET: { prefix: 'tm', length: 35, network: 'testnet' as const },
  TRANSPARENT_P2SH_TESTNET: { prefix: 't2', length: 35, network: 'testnet' as const },
  SPROUT: { prefix: 'zc', length: 95, network: 'mainnet' as const },
  SPROUT_TESTNET: { prefix: 'zt', length: 95, network: 'testnet' as const },
  SAPLING: { prefix: 'zs', minLength: 70, maxLength: 90, network: 'mainnet' as const },
  SAPLING_TESTNET: { prefix: 'ztestsapling', minLength: 70, maxLength: 120, network: 'testnet' as const },
  UNIFIED: { prefix: 'u1', minLength: 50, maxLength: 500, network: 'mainnet' as const },
  UNIFIED_TESTNET: { prefix: 'utest', minLength: 50, maxLength: 500, network: 'testnet' as const },
} as const;

/**
 * Configuration for address validation
 */
export interface AddressValidationOptions {
  /** Skip checksum validation (for testing only - NOT recommended for production) */
  skipChecksum?: boolean;
}

/** Global validation options (can be set for testing) */
let globalValidationOptions: AddressValidationOptions = { skipChecksum: false };

/**
 * Sets global validation options (primarily for testing)
 * @warning Setting skipChecksum=true in production is a security risk!
 */
export function setValidationOptions(options: AddressValidationOptions): void {
  globalValidationOptions = { ...globalValidationOptions, ...options };
}

/**
 * Resets validation options to defaults (strict checksum validation)
 */
export function resetValidationOptions(): void {
  globalValidationOptions = { skipChecksum: false };
}

// Base58 alphabet (no 0, O, I, l)
const BASE58_REGEX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

/**
 * Validates a Base58Check encoded address with real checksum verification
 */
function validateBase58Checksum(data: string): boolean {
  // Format check first
  if (!BASE58_REGEX.test(data)) {
    return false;
  }

  // Skip checksum if configured (testing only)
  if (globalValidationOptions.skipChecksum) {
    return true;
  }

  try {
    bs58check.decode(data);
    return true;
  } catch {
    return false;
  }
}

// Bech32 character set
const BECH32_REGEX = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/i;

/**
 * Check if string has mixed case (invalid for Bech32)
 */
function hasMixedCase(s: string): boolean {
  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);
  return hasLower && hasUpper;
}

/**
 * Validates a Bech32 encoded address with real checksum verification
 */
function validateBech32Checksum(data: string): boolean {
  // Bech32 rejects mixed case
  if (hasMixedCase(data)) {
    return false;
  }

  // Skip checksum if configured (testing only)
  if (globalValidationOptions.skipChecksum) {
    // Basic format check for Bech32
    const parts = data.toLowerCase().split('1');
    if (parts.length < 2) return false;
    const dataPart = parts.slice(1).join('1');
    return BECH32_REGEX.test(dataPart);
  }

  try {
    bech32.decode(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a Bech32m encoded address with real checksum verification
 */
function validateBech32mChecksum(data: string): boolean {
  // Bech32m rejects mixed case
  if (hasMixedCase(data)) {
    return false;
  }

  // Skip checksum if configured (testing only)
  if (globalValidationOptions.skipChecksum) {
    // Basic format check for Bech32m
    const parts = data.toLowerCase().split('1');
    if (parts.length < 2) return false;
    const dataPart = parts.slice(1).join('1');
    return BECH32_REGEX.test(dataPart);
  }

  try {
    bech32m.decode(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects the type of a Zcash address based on its prefix and validates checksum
 */
export function validateAddress(address: string): AddressType {
  if (!address || typeof address !== 'string') {
    return 'unknown';
  }

  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return 'unknown';
  }

  // Check Unified Address - use Bech32m encoding
  if (trimmed.startsWith('u1') || trimmed.toLowerCase().startsWith('utest')) {
    if (
      trimmed.length >= ADDRESS_FORMATS.UNIFIED.minLength &&
      trimmed.length <= ADDRESS_FORMATS.UNIFIED.maxLength &&
      validateBech32mChecksum(trimmed)
    ) {
      return 'unified';
    }
    return 'unknown';
  }

  // Check Sapling addresses - use Bech32 encoding
  if (trimmed.startsWith('zs') || trimmed.toLowerCase().startsWith('ztestsapling')) {
    const format = trimmed.startsWith('zs') ? ADDRESS_FORMATS.SAPLING : ADDRESS_FORMATS.SAPLING_TESTNET;
    if (
      trimmed.length >= format.minLength &&
      trimmed.length <= format.maxLength &&
      validateBech32Checksum(trimmed)
    ) {
      return 'sapling';
    }
    return 'unknown';
  }

  // Check Sprout addresses - use Base58Check encoding
  if (trimmed.startsWith('zc') || trimmed.startsWith('zt')) {
    if (!trimmed.toLowerCase().startsWith('ztestsapling')) {
      const format = trimmed.startsWith('zc') ? ADDRESS_FORMATS.SPROUT : ADDRESS_FORMATS.SPROUT_TESTNET;
      if (trimmed.length === format.length && validateBase58Checksum(trimmed)) {
        return 'sprout';
      }
    }
    return 'unknown';
  }

  // Check Transparent addresses - use Base58Check encoding
  if (trimmed.startsWith('t1') || trimmed.startsWith('t3') || trimmed.startsWith('tm') || trimmed.startsWith('t2')) {
    if (trimmed.length === 35 && validateBase58Checksum(trimmed)) {
      return 'transparent';
    }
    return 'unknown';
  }

  return 'unknown';
}

/**
 * Determines if an address is shielded (privacy-preserving)
 */
export function isShielded(address: string): boolean {
  const type = validateAddress(address);
  return type === 'sprout' || type === 'sapling' || type === 'unified';
}

/**
 * Parses a Unified Address to detect its component receivers
 *
 * WARNING: Full UA decoding requires librustzcash WASM bindings.
 * This function CANNOT determine which receiver types are present.
 */
export function parseUnifiedAddress(ua: string): UnifiedAddressComponents {
  const type = validateAddress(ua);
  if (type !== 'unified') {
    return {};
  }
  // Full UA decoding requires librustzcash WASM bindings
  return {
    unified: true,
    receivers: 'unknown',
    transparent: undefined,
    sapling: undefined,
  };
}

/**
 * Performs comprehensive address validation with detailed results
 */
export function validateAddressDetailed(address: string): AddressValidationResult {
  if (!address || typeof address !== 'string') {
    return { valid: false, type: 'unknown', shielded: false, network: 'unknown', error: 'Address must be a non-empty string' };
  }

  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return { valid: false, type: 'unknown', shielded: false, network: 'unknown', error: 'Address cannot be empty' };
  }

  const type = validateAddress(trimmed);
  if (type === 'unknown') {
    return { valid: false, type: 'unknown', shielded: false, network: 'unknown', error: 'Unrecognized address format or invalid checksum' };
  }

  let network: 'mainnet' | 'testnet' | 'unknown' = 'unknown';
  if (type === 'transparent') {
    network = (trimmed.startsWith('t1') || trimmed.startsWith('t3')) ? 'mainnet' : 'testnet';
  } else if (type === 'sprout') {
    network = trimmed.startsWith('zc') ? 'mainnet' : 'testnet';
  } else if (type === 'sapling') {
    network = trimmed.startsWith('zs') ? 'mainnet' : 'testnet';
  } else if (type === 'unified') {
    network = trimmed.startsWith('u1') ? 'mainnet' : 'testnet';
  }

  return { valid: true, type, shielded: isShielded(trimmed), network };
}

/**
 * Gets the network prefix requirements for a given address type and network
 */
export function getAddressPrefixes(
  type: Exclude<AddressType, 'unknown' | 'orchard'>,
  network: 'mainnet' | 'testnet' = 'mainnet'
): string[] {
  switch (type) {
    case 'transparent': return network === 'mainnet' ? ['t1', 't3'] : ['tm', 't2'];
    case 'sprout': return network === 'mainnet' ? ['zc'] : ['zt'];
    case 'sapling': return network === 'mainnet' ? ['zs'] : ['ztestsapling'];
    case 'unified': return network === 'mainnet' ? ['u1'] : ['utest'];
    default: return [];
  }
}
