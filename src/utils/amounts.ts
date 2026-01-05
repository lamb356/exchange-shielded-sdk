/**
 * Amount Utilities Module
 *
 * Provides utilities for handling ZEC amounts as zatoshis (bigint) to prevent
 * floating-point rounding errors that could lead to incorrect transaction amounts.
 *
 * 1 ZEC = 100,000,000 zatoshis (10^8)
 *
 * SECURITY: All internal amount handling should use zatoshis (bigint) to avoid
 * floating-point precision issues. Only convert to ZEC (number) for display purposes.
 *
 * @packageDocumentation
 */

/**
 * Number of zatoshis per ZEC
 */
export const ZATOSHIS_PER_ZEC = 100_000_000n;

/**
 * Maximum valid zatoshi amount (total ZEC supply * 10^8)
 * Total ZEC supply is 21,000,000 ZEC
 */
export const MAX_ZATOSHIS = 21_000_000n * ZATOSHIS_PER_ZEC;

/**
 * Minimum valid zatoshi amount (1 zatoshi)
 */
export const MIN_ZATOSHIS = 1n;

/**
 * Error thrown when amount validation fails
 */
export class AmountError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'AmountError';
  }
}

/**
 * Converts a ZEC amount (number) to zatoshis (bigint)
 *
 * @param zec - Amount in ZEC (e.g., 1.5 = 1.5 ZEC)
 * @returns Amount in zatoshis as bigint
 * @throws AmountError if the input is invalid (NaN, Infinity, negative)
 *
 * @example
 * ```typescript
 * const zatoshis = zecToZatoshis(1.5);
 * // Returns: 150000000n (150 million zatoshis)
 * ```
 */
export function zecToZatoshis(zec: number): bigint {
  if (typeof zec !== 'number' || isNaN(zec)) {
    throw new AmountError('ZEC amount must be a valid number', 'INVALID_ZEC_AMOUNT');
  }

  if (!isFinite(zec)) {
    throw new AmountError('ZEC amount must be finite', 'INFINITE_ZEC_AMOUNT');
  }

  if (zec < 0) {
    throw new AmountError('ZEC amount cannot be negative', 'NEGATIVE_ZEC_AMOUNT');
  }

  // Convert to zatoshis by multiplying by 10^8 and rounding
  // Use Math.round to handle floating-point precision issues
  const zatoshis = BigInt(Math.round(zec * 100_000_000));

  return zatoshis;
}

/**
 * Converts zatoshis (bigint) to ZEC amount (number)
 *
 * WARNING: This conversion may lose precision for very large amounts.
 * Use only for display purposes, not for calculations.
 *
 * @param zatoshis - Amount in zatoshis
 * @returns Amount in ZEC as number
 * @throws AmountError if the input is invalid (negative)
 *
 * @example
 * ```typescript
 * const zec = zatoshisToZec(150000000n);
 * // Returns: 1.5
 * ```
 */
export function zatoshisToZec(zatoshis: bigint): number {
  if (typeof zatoshis !== 'bigint') {
    throw new AmountError('Zatoshis must be a bigint', 'INVALID_ZATOSHI_TYPE');
  }

  if (zatoshis < 0n) {
    throw new AmountError('Zatoshis cannot be negative', 'NEGATIVE_ZATOSHIS');
  }

  // Convert to ZEC by dividing by 10^8
  // Use Number() conversion which is safe for amounts up to MAX_SAFE_INTEGER zatoshis
  // (which is about 90 million ZEC, well above the 21 million supply)
  return Number(zatoshis) / 100_000_000;
}

/**
 * Validates that a zatoshi amount is within valid bounds
 *
 * @param zatoshis - Amount in zatoshis to validate
 * @throws AmountError if amount is negative or exceeds maximum
 *
 * @example
 * ```typescript
 * validateZatoshis(100000000n); // OK - 1 ZEC
 * validateZatoshis(-1n); // Throws: "Zatoshi amount cannot be negative"
 * ```
 */
export function validateZatoshis(zatoshis: bigint): void {
  if (typeof zatoshis !== 'bigint') {
    throw new AmountError('Zatoshis must be a bigint', 'INVALID_ZATOSHI_TYPE');
  }

  if (zatoshis < 0n) {
    throw new AmountError('Zatoshi amount cannot be negative', 'NEGATIVE_ZATOSHIS');
  }

  if (zatoshis > MAX_ZATOSHIS) {
    throw new AmountError(
      `Zatoshi amount ${zatoshis} exceeds maximum of ${MAX_ZATOSHIS} (21 million ZEC)`,
      'EXCESSIVE_ZATOSHIS'
    );
  }
}

/**
 * Validates that a zatoshi amount is greater than zero and within bounds
 *
 * @param zatoshis - Amount in zatoshis to validate
 * @throws AmountError if amount is zero, negative, or exceeds maximum
 */
export function validatePositiveZatoshis(zatoshis: bigint): void {
  validateZatoshis(zatoshis);

  if (zatoshis === 0n) {
    throw new AmountError('Zatoshi amount must be greater than zero', 'ZERO_ZATOSHIS');
  }
}

/**
 * Formats a zatoshi amount for display
 *
 * @param zatoshis - Amount in zatoshis
 * @param options - Formatting options
 * @returns Formatted string (e.g., "1.50000000 ZEC")
 */
export function formatZatoshis(
  zatoshis: bigint,
  options: {
    /** Include "ZEC" suffix (default: true) */
    includeSuffix?: boolean;
    /** Number of decimal places (default: 8) */
    decimals?: number;
    /** Use grouping separators (default: false) */
    useGrouping?: boolean;
  } = {}
): string {
  const { includeSuffix = true, decimals = 8, useGrouping = false } = options;

  const zec = zatoshisToZec(zatoshis);

  let formatted: string;
  if (useGrouping) {
    formatted = zec.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } else {
    formatted = zec.toFixed(decimals);
  }

  return includeSuffix ? `${formatted} ZEC` : formatted;
}

/**
 * Parses a string amount to zatoshis
 *
 * @param amountStr - String representation of amount (e.g., "1.5", "100")
 * @param isZec - If true, treat as ZEC; if false, treat as zatoshis (default: true)
 * @returns Amount in zatoshis
 * @throws AmountError if the string is not a valid amount
 */
export function parseAmountToZatoshis(amountStr: string, isZec: boolean = true): bigint {
  const trimmed = amountStr.trim();

  if (trimmed.length === 0) {
    throw new AmountError('Amount string cannot be empty', 'EMPTY_AMOUNT_STRING');
  }

  // Validate format - only allow plain decimal numbers
  if (!/^-?\d+\.?\d*$/.test(trimmed) && !/^-?\d*\.?\d+$/.test(trimmed)) {
    throw new AmountError(
      `Invalid amount format: "${trimmed}". Must be a plain decimal number.`,
      'INVALID_AMOUNT_FORMAT'
    );
  }

  const num = parseFloat(trimmed);

  if (isNaN(num)) {
    throw new AmountError(`Invalid amount: "${trimmed}"`, 'INVALID_AMOUNT');
  }

  if (!isFinite(num)) {
    throw new AmountError('Amount must be finite', 'INFINITE_AMOUNT');
  }

  if (isZec) {
    return zecToZatoshis(num);
  } else {
    // Parse as zatoshis directly
    if (num < 0) {
      throw new AmountError('Amount cannot be negative', 'NEGATIVE_AMOUNT');
    }
    return BigInt(Math.round(num));
  }
}

/**
 * Adds two zatoshi amounts safely
 *
 * @param a - First amount in zatoshis
 * @param b - Second amount in zatoshis
 * @returns Sum in zatoshis
 * @throws AmountError if result exceeds maximum
 */
export function addZatoshis(a: bigint, b: bigint): bigint {
  const sum = a + b;
  validateZatoshis(sum);
  return sum;
}

/**
 * Subtracts zatoshi amounts safely
 *
 * @param a - Amount to subtract from
 * @param b - Amount to subtract
 * @returns Difference in zatoshis
 * @throws AmountError if result is negative
 */
export function subtractZatoshis(a: bigint, b: bigint): bigint {
  const diff = a - b;
  if (diff < 0n) {
    throw new AmountError('Subtraction would result in negative amount', 'NEGATIVE_RESULT');
  }
  return diff;
}

/**
 * Safely serialize an object containing Zatoshi/bigint values to JSON
 *
 * JavaScript's JSON.stringify() throws on bigint. This function converts
 * bigint values to strings for safe serialization.
 *
 * @param obj - The object to serialize
 * @returns JSON string with bigints converted to strings
 *
 * @example
 * ```typescript
 * const json = safeJsonStringify({ amount: 100n, name: 'test' });
 * // Returns: '{"amount":"100","name":"test"}'
 * ```
 */
export function safeJsonStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

/**
 * Parse JSON that may contain zatoshi strings back to bigints
 *
 * Use this to deserialize JSON that was serialized with safeJsonStringify.
 * Specify which keys should be converted from string to bigint.
 *
 * @param json - The JSON string to parse
 * @param zatoshiKeys - Array of key names that should be converted to bigint
 * @returns Parsed object with specified keys as bigint
 *
 * @example
 * ```typescript
 * const json = '{"amount":"150000000","fee":"10000"}';
 * const parsed = safeJsonParse<{ amount: bigint; fee: bigint }>(
 *   json,
 *   ['amount', 'fee']
 * );
 * // parsed.amount === 150_000_000n
 * // parsed.fee === 10_000n
 * ```
 */
export function safeJsonParse<T>(json: string, zatoshiKeys: string[]): T {
  return JSON.parse(json, (key, value) => {
    if (zatoshiKeys.includes(key) && typeof value === 'string' && /^\d+$/.test(value)) {
      return BigInt(value);
    }
    return value;
  });
}
