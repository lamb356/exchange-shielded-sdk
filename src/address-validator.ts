/**
 * Address Validator Module for Zcash addresses
 *
 * Supports validation of:
 * - Transparent addresses (t1/t3): Base58Check encoded
 * - Sprout addresses (zc): Base58Check encoded (legacy shielded)
 * - Sapling addresses (zs): Bech32 encoded
 * - Unified addresses (u1): Bech32m encoded (may contain multiple receivers)
 *
 * Note: This is a regex-based validation for MVP.
 * Future versions will use WASM bindings to librustzcash for cryptographic validation.
 */

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
 */
export interface UnifiedAddressComponents {
  /** Transparent (P2PKH or P2SH) receiver address if present */
  transparent?: string;
  /** Sapling receiver address if present */
  sapling?: string;
  /** Whether an Orchard receiver is detected (true if UA starts with u1) */
  orchard?: boolean;
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

// Base58 alphabet (Bitcoin/Zcash)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_REGEX = new RegExp(`^[${BASE58_ALPHABET}]+$`);

// Bech32 alphabet (lowercase only for validation, but we normalize)
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_REGEX = new RegExp(`^[${BECH32_ALPHABET}]+$`);

/**
 * Address format specifications
 */
const ADDRESS_FORMATS = {
  // Transparent P2PKH mainnet: starts with 't1', 35 characters
  TRANSPARENT_P2PKH: {
    prefix: 't1',
    length: 35,
    network: 'mainnet' as const,
  },
  // Transparent P2SH mainnet: starts with 't3', 35 characters
  TRANSPARENT_P2SH: {
    prefix: 't3',
    length: 35,
    network: 'mainnet' as const,
  },
  // Transparent P2PKH testnet: starts with 'tm', 35 characters
  TRANSPARENT_P2PKH_TESTNET: {
    prefix: 'tm',
    length: 35,
    network: 'testnet' as const,
  },
  // Transparent P2SH testnet: starts with 't2', 35 characters
  TRANSPARENT_P2SH_TESTNET: {
    prefix: 't2',
    length: 35,
    network: 'testnet' as const,
  },
  // Sprout mainnet: starts with 'zc', 95 characters
  SPROUT: {
    prefix: 'zc',
    length: 95,
    network: 'mainnet' as const,
  },
  // Sprout testnet: starts with 'zt', 95 characters
  SPROUT_TESTNET: {
    prefix: 'zt',
    length: 95,
    network: 'testnet' as const,
  },
  // Sapling mainnet: starts with 'zs', Bech32, typically 78 characters
  SAPLING: {
    prefix: 'zs',
    minLength: 70,
    maxLength: 90,
    network: 'mainnet' as const,
  },
  // Sapling testnet: starts with 'ztestsapling', Bech32
  SAPLING_TESTNET: {
    prefix: 'ztestsapling',
    minLength: 70,
    maxLength: 120,
    network: 'testnet' as const,
  },
  // Unified mainnet: starts with 'u1', Bech32m, variable length
  UNIFIED: {
    prefix: 'u1',
    minLength: 50,
    maxLength: 500,
    network: 'mainnet' as const,
  },
  // Unified testnet: starts with 'utest', Bech32m
  UNIFIED_TESTNET: {
    prefix: 'utest',
    minLength: 50,
    maxLength: 500,
    network: 'testnet' as const,
  },
} as const;

/**
 * Validates a Base58Check encoded string format
 * Note: This only validates the character set and length, not the checksum
 */
function isValidBase58Format(data: string): boolean {
  return BASE58_REGEX.test(data);
}

/**
 * Validates a Bech32/Bech32m encoded string format
 * Note: This only validates the character set, not the checksum
 */
function isValidBech32Format(data: string): boolean {
  // Bech32 is case-insensitive but must not be mixed case
  const lower = data.toLowerCase();
  const upper = data.toUpperCase();

  if (data !== lower && data !== upper) {
    return false; // Mixed case not allowed
  }

  // Find the separator '1' (last occurrence)
  const sepIndex = data.toLowerCase().lastIndexOf('1');
  if (sepIndex < 1 || sepIndex + 7 > data.length) {
    return false; // Invalid separator position
  }

  const dataPart = data.slice(sepIndex + 1).toLowerCase();
  return BECH32_REGEX.test(dataPart);
}

/**
 * Detects the type of a Zcash address based on its prefix and format
 *
 * @param address - The address string to analyze
 * @returns The detected address type
 *
 * @example
 * ```typescript
 * validateAddress('t1abc...') // returns 'transparent'
 * validateAddress('zs1abc...') // returns 'sapling'
 * validateAddress('u1abc...') // returns 'unified'
 * ```
 */
export function validateAddress(address: string): AddressType {
  if (!address || typeof address !== 'string') {
    return 'unknown';
  }

  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return 'unknown';
  }

  // Check Unified Address (must check before Sapling due to overlapping patterns)
  if (trimmed.startsWith('u1') || trimmed.toLowerCase().startsWith('utest')) {
    if (
      trimmed.length >= ADDRESS_FORMATS.UNIFIED.minLength &&
      trimmed.length <= ADDRESS_FORMATS.UNIFIED.maxLength &&
      isValidBech32Format(trimmed)
    ) {
      return 'unified';
    }
  }

  // Check Sapling addresses
  if (trimmed.startsWith('zs') || trimmed.toLowerCase().startsWith('ztestsapling')) {
    const format = trimmed.startsWith('zs')
      ? ADDRESS_FORMATS.SAPLING
      : ADDRESS_FORMATS.SAPLING_TESTNET;

    if (
      trimmed.length >= format.minLength &&
      trimmed.length <= format.maxLength &&
      isValidBech32Format(trimmed)
    ) {
      return 'sapling';
    }
  }

  // Check Sprout addresses
  if (trimmed.startsWith('zc') || trimmed.startsWith('zt')) {
    // Make sure it's not a Sapling testnet address
    if (!trimmed.toLowerCase().startsWith('ztestsapling')) {
      const format = trimmed.startsWith('zc')
        ? ADDRESS_FORMATS.SPROUT
        : ADDRESS_FORMATS.SPROUT_TESTNET;

      if (trimmed.length === format.length && isValidBase58Format(trimmed)) {
        return 'sprout';
      }
    }
  }

  // Check Transparent addresses
  if (
    trimmed.startsWith('t1') ||
    trimmed.startsWith('t3') ||
    trimmed.startsWith('tm') ||
    trimmed.startsWith('t2')
  ) {
    if (trimmed.length === 35 && isValidBase58Format(trimmed)) {
      return 'transparent';
    }
  }

  return 'unknown';
}

/**
 * Determines if an address is shielded (privacy-preserving)
 *
 * Shielded address types:
 * - Sprout (legacy, deprecated)
 * - Sapling
 * - Orchard
 * - Unified (may contain shielded receivers)
 *
 * @param address - The address string to check
 * @returns true if the address is a shielded type, false otherwise
 *
 * @example
 * ```typescript
 * isShielded('t1abc...') // returns false (transparent)
 * isShielded('zs1abc...') // returns true (sapling)
 * isShielded('u1abc...') // returns true (unified)
 * ```
 */
export function isShielded(address: string): boolean {
  const type = validateAddress(address);
  return type === 'sprout' || type === 'sapling' || type === 'orchard' || type === 'unified';
}

/**
 * Parses a Unified Address to detect its component receivers
 *
 * Note: This is a detection-only implementation for MVP.
 * Full parsing requires WASM bindings to librustzcash to decode the actual receiver data.
 *
 * A Unified Address can contain multiple receiver types:
 * - Transparent (P2PKH or P2SH)
 * - Sapling
 * - Orchard
 *
 * @param ua - The Unified Address string to parse
 * @returns Object indicating which receiver types are present
 *
 * @example
 * ```typescript
 * const components = parseUnifiedAddress('u1abc...');
 * // Returns: { orchard: true, sapling: undefined, transparent: undefined }
 * ```
 */
export function parseUnifiedAddress(ua: string): UnifiedAddressComponents {
  const type = validateAddress(ua);

  if (type !== 'unified') {
    return {};
  }

  // For MVP, we can only detect that it's a unified address
  // Full parsing requires librustzcash WASM bindings
  //
  // Unified addresses are encoded with Bech32m and contain:
  // - A human-readable part (HRP): 'u' for mainnet, 'utest' for testnet
  // - A separator: '1'
  // - The data part containing encoded receivers
  //
  // The data part encodes multiple receiver types using a TLV (Type-Length-Value) format.
  // Without proper decoding, we cannot determine which receivers are present.
  //
  // For now, we assume all u1 addresses likely contain an Orchard receiver
  // (as this is the primary reason for using unified addresses post-NU5)

  return {
    // Orchard detection: unified addresses typically include Orchard after NU5
    orchard: true,

    // Sapling and transparent require actual decoding
    // These will be undefined until we implement WASM bindings
    sapling: undefined,
    transparent: undefined,
  };
}

/**
 * Performs comprehensive address validation with detailed results
 *
 * @param address - The address string to validate
 * @returns Detailed validation result including type, network, and shielded status
 *
 * @example
 * ```typescript
 * const result = validateAddressDetailed('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU');
 * // Returns: {
 * //   valid: true,
 * //   type: 'transparent',
 * //   shielded: false,
 * //   network: 'mainnet'
 * // }
 * ```
 */
export function validateAddressDetailed(address: string): AddressValidationResult {
  if (!address || typeof address !== 'string') {
    return {
      valid: false,
      type: 'unknown',
      shielded: false,
      network: 'unknown',
      error: 'Address must be a non-empty string',
    };
  }

  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      type: 'unknown',
      shielded: false,
      network: 'unknown',
      error: 'Address cannot be empty',
    };
  }

  const type = validateAddress(trimmed);

  if (type === 'unknown') {
    return {
      valid: false,
      type: 'unknown',
      shielded: false,
      network: 'unknown',
      error: 'Unrecognized address format',
    };
  }

  // Determine network
  let network: 'mainnet' | 'testnet' | 'unknown' = 'unknown';

  if (type === 'transparent') {
    if (trimmed.startsWith('t1') || trimmed.startsWith('t3')) {
      network = 'mainnet';
    } else if (trimmed.startsWith('tm') || trimmed.startsWith('t2')) {
      network = 'testnet';
    }
  } else if (type === 'sprout') {
    network = trimmed.startsWith('zc') ? 'mainnet' : 'testnet';
  } else if (type === 'sapling') {
    network = trimmed.startsWith('zs') ? 'mainnet' : 'testnet';
  } else if (type === 'unified') {
    network = trimmed.startsWith('u1') ? 'mainnet' : 'testnet';
  }

  return {
    valid: true,
    type,
    shielded: isShielded(trimmed),
    network,
  };
}

/**
 * Gets the network prefix requirements for a given address type and network
 *
 * @param type - The address type
 * @param network - The target network ('mainnet' or 'testnet')
 * @returns Array of valid prefixes for the given type and network
 */
export function getAddressPrefixes(
  type: Exclude<AddressType, 'unknown' | 'orchard'>,
  network: 'mainnet' | 'testnet' = 'mainnet'
): string[] {
  switch (type) {
    case 'transparent':
      return network === 'mainnet' ? ['t1', 't3'] : ['tm', 't2'];
    case 'sprout':
      return network === 'mainnet' ? ['zc'] : ['zt'];
    case 'sapling':
      return network === 'mainnet' ? ['zs'] : ['ztestsapling'];
    case 'unified':
      return network === 'mainnet' ? ['u1'] : ['utest'];
    default:
      return [];
  }
}
