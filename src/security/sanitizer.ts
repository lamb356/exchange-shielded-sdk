/**
 * Input Sanitization Module
 *
 * Provides functions to sanitize and validate user inputs before processing.
 * All user input must be sanitized to prevent injection attacks and ensure
 * data integrity.
 *
 * @packageDocumentation
 */

import { validateAddress, AddressType } from '../address-validator.js';

/**
 * Result of address sanitization
 */
export interface SanitizedAddress {
  /** The sanitized address string */
  address: string;
  /** Whether the original input was valid */
  valid: boolean;
  /** The detected address type */
  type: AddressType;
  /** Error message if invalid */
  error?: string;
}

/**
 * Result of amount sanitization
 */
export interface SanitizedAmount {
  /** The sanitized amount as a number */
  amount: number;
  /** Whether the original input was valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}

/**
 * Result of memo sanitization
 */
export interface SanitizedMemo {
  /** The sanitized memo (hex-encoded) */
  memo: string;
  /** Whether the original input was valid */
  valid: boolean;
  /** Original length in bytes */
  byteLength: number;
  /** Error message if invalid */
  error?: string;
}

/**
 * Configuration for redaction
 */
export interface RedactionConfig {
  /** Fields to always redact */
  alwaysRedact?: string[];
  /** Fields to partially redact (show first/last chars) */
  partialRedact?: string[];
  /** Number of characters to show at start/end for partial redaction */
  partialShowChars?: number;
  /** Replacement string for redacted values */
  redactedPlaceholder?: string;
  /** Redact shielded addresses */
  redactShieldedAddresses?: boolean;
}

/**
 * Sensitive field patterns that should be redacted
 */
const SENSITIVE_PATTERNS = [
  /key/i,
  /secret/i,
  /password/i,
  /passphrase/i,
  /private/i,
  /seed/i,
  /mnemonic/i,
  /credential/i,
  /token/i,
  /auth/i,
];

/**
 * Fields that should always be redacted
 */
const DEFAULT_REDACT_FIELDS = [
  'spendingKey',
  'viewingKey',
  'privateKey',
  'secretKey',
  'password',
  'passphrase',
  'seed',
  'mnemonic',
  'encryptionKey',
  'apiKey',
  'apiSecret',
  'authToken',
  'accessToken',
  'refreshToken',
];

/**
 * Fields that should be partially redacted (show first/last chars)
 */
const DEFAULT_PARTIAL_REDACT_FIELDS = ['address', 'txid', 'transactionId', 'operationId'];

/**
 * Maximum allowed address length
 */
const MAX_ADDRESS_LENGTH = 512;

/**
 * Maximum allowed memo length in bytes (Zcash memo limit)
 */
const MAX_MEMO_BYTES = 512;

/**
 * Maximum allowed amount (arbitrary but reasonable limit)
 */
const MAX_AMOUNT = 21_000_000; // Total ZEC supply

/**
 * Minimum allowed amount
 */
const MIN_AMOUNT = 0.00000001; // 1 zatoshi in ZEC

/**
 * Valid hex characters
 */
const HEX_REGEX = /^[0-9a-fA-F]*$/;

/**
 * Sanitizes a Zcash address
 *
 * Validates and sanitizes the input address, removing any potentially
 * dangerous characters while preserving the address if valid.
 *
 * @param input - The address string to sanitize
 * @returns Sanitization result with cleaned address or error
 *
 * @example
 * ```typescript
 * const result = sanitizeAddress('  zs1abc...  ');
 * if (result.valid) {
 *   console.log('Sanitized address:', result.address);
 * } else {
 *   console.error('Invalid address:', result.error);
 * }
 * ```
 */
export function sanitizeAddress(input: string): SanitizedAddress {
  // Handle null/undefined
  if (input === null || input === undefined) {
    return {
      address: '',
      valid: false,
      type: 'unknown',
      error: 'Address is required',
    };
  }

  // Convert to string if needed
  const str = String(input);

  // Trim whitespace
  const trimmed = str.trim();

  // Check for empty string
  if (trimmed.length === 0) {
    return {
      address: '',
      valid: false,
      type: 'unknown',
      error: 'Address cannot be empty',
    };
  }

  // Check maximum length
  if (trimmed.length > MAX_ADDRESS_LENGTH) {
    return {
      address: '',
      valid: false,
      type: 'unknown',
      error: `Address exceeds maximum length of ${MAX_ADDRESS_LENGTH} characters`,
    };
  }

  // Remove any null bytes or control characters
  const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, '');

  // Validate the address
  const type = validateAddress(sanitized);

  if (type === 'unknown') {
    return {
      address: '',
      valid: false,
      type: 'unknown',
      error: 'Invalid address format',
    };
  }

  return {
    address: sanitized,
    valid: true,
    type,
  };
}

/**
 * Sanitizes an amount value
 *
 * Validates and sanitizes the input amount, ensuring it's a valid
 * positive number within reasonable bounds.
 *
 * @param input - The amount to sanitize (can be string or number)
 * @returns Sanitization result with cleaned amount or error
 *
 * @example
 * ```typescript
 * const result = sanitizeAmount('1.5');
 * if (result.valid) {
 *   console.log('Amount:', result.amount);
 * }
 * ```
 */
export function sanitizeAmount(input: unknown): SanitizedAmount {
  // Handle null/undefined
  if (input === null || input === undefined) {
    return {
      amount: 0,
      valid: false,
      error: 'Amount is required',
    };
  }

  let numValue: number;

  // Parse string inputs
  if (typeof input === 'string') {
    const trimmed = input.trim();

    // Check for empty string
    if (trimmed.length === 0) {
      return {
        amount: 0,
        valid: false,
        error: 'Amount cannot be empty',
      };
    }

    // Remove any non-numeric characters except . and -
    const cleaned = trimmed.replace(/[^0-9.\-]/g, '');

    numValue = parseFloat(cleaned);
  } else if (typeof input === 'number') {
    numValue = input;
  } else {
    return {
      amount: 0,
      valid: false,
      error: 'Amount must be a number or numeric string',
    };
  }

  // Check for NaN
  if (isNaN(numValue)) {
    return {
      amount: 0,
      valid: false,
      error: 'Amount is not a valid number',
    };
  }

  // Check for Infinity
  if (!isFinite(numValue)) {
    return {
      amount: 0,
      valid: false,
      error: 'Amount must be a finite number',
    };
  }

  // Check for negative values
  if (numValue < 0) {
    return {
      amount: 0,
      valid: false,
      error: 'Amount cannot be negative',
    };
  }

  // Check for zero
  if (numValue === 0) {
    return {
      amount: 0,
      valid: false,
      error: 'Amount must be greater than zero',
    };
  }

  // Check minimum amount
  if (numValue < MIN_AMOUNT) {
    return {
      amount: 0,
      valid: false,
      error: `Amount must be at least ${MIN_AMOUNT} ZEC (1 zatoshi)`,
    };
  }

  // Check maximum amount
  if (numValue > MAX_AMOUNT) {
    return {
      amount: 0,
      valid: false,
      error: `Amount exceeds maximum of ${MAX_AMOUNT} ZEC`,
    };
  }

  // Round to 8 decimal places (zatoshi precision)
  const rounded = Math.round(numValue * 100_000_000) / 100_000_000;

  return {
    amount: rounded,
    valid: true,
  };
}

/**
 * Sanitizes a memo field
 *
 * Validates and sanitizes the memo input, ensuring it's valid hex
 * and within the 512-byte limit.
 *
 * @param input - The memo string to sanitize (should be hex-encoded)
 * @returns Sanitization result with cleaned memo or error
 *
 * @example
 * ```typescript
 * const result = sanitizeMemo('48656c6c6f'); // "Hello" in hex
 * if (result.valid) {
 *   console.log('Memo:', result.memo);
 * }
 * ```
 */
export function sanitizeMemo(input: string): SanitizedMemo {
  // Handle null/undefined
  if (input === null || input === undefined) {
    return {
      memo: '',
      valid: true,
      byteLength: 0,
    };
  }

  // Convert to string if needed
  const str = String(input);

  // Trim whitespace
  const trimmed = str.trim();

  // Empty memo is valid
  if (trimmed.length === 0) {
    return {
      memo: '',
      valid: true,
      byteLength: 0,
    };
  }

  // Remove any 0x prefix
  let hex = trimmed;
  if (hex.toLowerCase().startsWith('0x')) {
    hex = hex.slice(2);
  }

  // Check for valid hex characters
  if (!HEX_REGEX.test(hex)) {
    return {
      memo: '',
      valid: false,
      byteLength: 0,
      error: 'Memo must be hex-encoded',
    };
  }

  // Ensure even number of characters (complete bytes)
  if (hex.length % 2 !== 0) {
    hex = '0' + hex;
  }

  // Calculate byte length
  const byteLength = hex.length / 2;

  // Check maximum length
  if (byteLength > MAX_MEMO_BYTES) {
    return {
      memo: '',
      valid: false,
      byteLength,
      error: `Memo exceeds maximum of ${MAX_MEMO_BYTES} bytes`,
    };
  }

  return {
    memo: hex.toLowerCase(),
    valid: true,
    byteLength,
  };
}

/**
 * Encodes a text string to hex for use as a memo
 *
 * @param text - The text to encode
 * @returns Hex-encoded string
 */
export function textToMemoHex(text: string): string {
  return Buffer.from(text, 'utf8').toString('hex');
}

/**
 * Decodes a hex memo to text
 *
 * @param hex - The hex string to decode
 * @returns Decoded text string
 */
export function memoHexToText(hex: string): string {
  // Remove trailing null bytes
  let cleaned = hex.replace(/00+$/, '');
  if (cleaned.length % 2 !== 0) {
    cleaned = cleaned + '0';
  }
  return Buffer.from(cleaned, 'hex').toString('utf8');
}

/**
 * Redacts sensitive data from an object for safe logging
 *
 * Creates a deep copy of the object with sensitive fields redacted.
 * This ensures that keys, passwords, and other sensitive data never
 * appear in log output.
 *
 * @param obj - The object to redact
 * @param config - Optional redaction configuration
 * @returns A new object with sensitive fields redacted
 *
 * @example
 * ```typescript
 * const request = {
 *   address: 'zs1abc...',
 *   spendingKey: 'secret-key-data',
 *   amount: 1.5
 * };
 *
 * const safe = redactSensitiveData(request);
 * console.log(safe);
 * // { address: 'zs1a...abc', spendingKey: '[REDACTED]', amount: 1.5 }
 * ```
 */
export function redactSensitiveData(obj: object, config?: RedactionConfig): object {
  const settings: Required<RedactionConfig> = {
    alwaysRedact: config?.alwaysRedact ?? DEFAULT_REDACT_FIELDS,
    partialRedact: config?.partialRedact ?? DEFAULT_PARTIAL_REDACT_FIELDS,
    partialShowChars: config?.partialShowChars ?? 4,
    redactedPlaceholder: config?.redactedPlaceholder ?? '[REDACTED]',
    redactShieldedAddresses: config?.redactShieldedAddresses ?? true,
  };

  return redactObject(obj, settings, new WeakSet()) as object;
}

/**
 * Recursively redacts an object
 */
function redactObject(
  obj: unknown,
  config: Required<RedactionConfig>,
  seen: WeakSet<object>
): unknown {
  // Handle null/undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitives
  if (typeof obj !== 'object') {
    return obj;
  }

  // Handle circular references
  if (seen.has(obj as object)) {
    return '[CIRCULAR]';
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, config, seen));
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj;
  }

  // Handle Buffer
  if (Buffer.isBuffer(obj)) {
    return config.redactedPlaceholder;
  }

  // Mark as seen for circular reference detection
  seen.add(obj as object);

  // Handle plain objects
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = redactValue(key, value, config, seen);
  }

  return result;
}

/**
 * Redacts a single value based on its key
 */
function redactValue(
  key: string,
  value: unknown,
  config: Required<RedactionConfig>,
  seen: WeakSet<object>
): unknown {
  // Check if this field should be fully redacted
  if (shouldFullyRedact(key, config)) {
    return config.redactedPlaceholder;
  }

  // Check if this field should be partially redacted
  if (shouldPartiallyRedact(key, config)) {
    return partialRedact(value, config);
  }

  // Check for sensitive patterns in the key name
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))) {
    return config.redactedPlaceholder;
  }

  // Check for shielded address values
  if (config.redactShieldedAddresses && typeof value === 'string') {
    const addrType = validateAddress(value);
    if (addrType !== 'unknown' && addrType !== 'transparent') {
      // Partially redact shielded addresses
      return partialRedact(value, config);
    }
  }

  // Recursively process nested objects
  if (typeof value === 'object' && value !== null) {
    return redactObject(value, config, seen);
  }

  return value;
}

/**
 * Checks if a field should be fully redacted
 */
function shouldFullyRedact(key: string, config: Required<RedactionConfig>): boolean {
  const lowerKey = key.toLowerCase();
  return config.alwaysRedact.some(
    (field) => field.toLowerCase() === lowerKey || lowerKey.includes(field.toLowerCase())
  );
}

/**
 * Checks if a field should be partially redacted
 */
function shouldPartiallyRedact(key: string, config: Required<RedactionConfig>): boolean {
  const lowerKey = key.toLowerCase();
  return config.partialRedact.some((field) => field.toLowerCase() === lowerKey);
}

/**
 * Partially redacts a value, showing only first/last characters
 */
function partialRedact(value: unknown, config: Required<RedactionConfig>): string {
  if (typeof value !== 'string') {
    return config.redactedPlaceholder;
  }

  const str = value;
  const showChars = config.partialShowChars;

  if (str.length <= showChars * 2) {
    return config.redactedPlaceholder;
  }

  const start = str.slice(0, showChars);
  const end = str.slice(-showChars);

  return `${start}...${end}`;
}

/**
 * Sanitizes a user ID
 *
 * @param input - The user ID to sanitize
 * @returns Sanitized user ID or null if invalid
 */
export function sanitizeUserId(input: string): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Trim and remove control characters
  const sanitized = input.trim().replace(/[\x00-\x1F\x7F]/g, '');

  // Check length
  if (sanitized.length === 0 || sanitized.length > 256) {
    return null;
  }

  // Allow alphanumeric, dash, underscore, and period
  if (!/^[a-zA-Z0-9._-]+$/.test(sanitized)) {
    return null;
  }

  return sanitized;
}

/**
 * Sanitizes a transaction ID
 *
 * @param input - The transaction ID to sanitize
 * @returns Sanitized transaction ID or null if invalid
 */
export function sanitizeTransactionId(input: string): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Trim whitespace
  const trimmed = input.trim();

  // Transaction IDs should be 64 hex characters
  if (trimmed.length !== 64) {
    return null;
  }

  // Check for valid hex
  if (!HEX_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}
