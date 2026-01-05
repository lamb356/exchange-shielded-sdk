/**
 * Money Types Module
 *
 * Provides branded types for zatoshis to prevent accidental unit mixing.
 * 1 ZEC = 100,000,000 zatoshis
 *
 * @packageDocumentation
 */

/**
 * Branded type for zatoshis to prevent accidental unit mixing.
 * 1 ZEC = 100,000,000 zatoshis
 */
declare const ZatoshiBrand: unique symbol;
export type Zatoshi = bigint & { readonly [ZatoshiBrand]: 'Zatoshi' };

/**
 * Create a Zatoshi from a bigint (validates non-negative)
 *
 * @param value - The bigint value to convert to Zatoshi
 * @returns A branded Zatoshi value
 * @throws Error if value is negative
 *
 * @example
 * ```typescript
 * const amount = zatoshi(100_000_000n);  // 1 ZEC
 * ```
 */
export function zatoshi(value: bigint): Zatoshi {
  if (value < 0n) {
    throw new Error('Zatoshi cannot be negative');
  }
  return value as Zatoshi;
}

/**
 * Create a Zatoshi from a number of ZEC
 *
 * @param zec - The ZEC amount as a number
 * @returns A branded Zatoshi value
 * @throws Error if zec is not a non-negative finite number
 *
 * @example
 * ```typescript
 * const amount = zecToZatoshi(1.5);  // 150,000,000 zatoshis
 * ```
 */
export function zecToZatoshi(zec: number): Zatoshi {
  if (!Number.isFinite(zec) || zec < 0) {
    throw new Error('ZEC must be a non-negative finite number');
  }
  return zatoshi(BigInt(Math.round(zec * 100_000_000)));
}

/**
 * Convert Zatoshi to ZEC number (for display only)
 *
 * WARNING: This conversion may lose precision for very large amounts.
 * Use only for display purposes, not for calculations.
 *
 * @param z - The Zatoshi amount
 * @returns The ZEC amount as a number
 *
 * @example
 * ```typescript
 * const zec = zatoshiToZec(zatoshi(150_000_000n));  // 1.5
 * ```
 */
export function zatoshiToZec(z: Zatoshi): number {
  return Number(z) / 100_000_000;
}

/**
 * String representation for JSON serialization
 */
export type ZatoshiString = string & { readonly __brand: 'ZatoshiString' };

/**
 * Convert Zatoshi to string for JSON serialization
 *
 * @param z - The Zatoshi amount
 * @returns A branded string representation
 *
 * @example
 * ```typescript
 * const str = zatoshiToString(zatoshi(150_000_000n));  // "150000000"
 * ```
 */
export function zatoshiToString(z: Zatoshi): ZatoshiString {
  return z.toString() as ZatoshiString;
}

/**
 * Parse a string back to Zatoshi
 *
 * @param s - The string representation
 * @returns A branded Zatoshi value
 * @throws Error if the string is not a valid non-negative integer
 *
 * @example
 * ```typescript
 * const amount = stringToZatoshi("150000000");  // 150,000,000 zatoshis
 * ```
 */
export function stringToZatoshi(s: string): Zatoshi {
  const value = BigInt(s);
  return zatoshi(value);
}

/** 1 ZEC in zatoshis */
export const ONE_ZEC: Zatoshi = zatoshi(100_000_000n);

/** Maximum ZEC supply in zatoshis (21 million ZEC) */
export const MAX_SUPPLY: Zatoshi = zatoshi(21_000_000n * 100_000_000n);
