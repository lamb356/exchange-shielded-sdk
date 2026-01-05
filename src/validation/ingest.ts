/**
 * Input Validation and Parsing Module
 *
 * Provides runtime validation for external inputs.
 * This is the SINGLE entry point for converting external amounts to Zatoshi.
 *
 * @packageDocumentation
 */

import { Zatoshi, zatoshi, MAX_SUPPLY } from '../types/money.js';

/**
 * Error thrown when input validation fails
 */
export class IngestValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = 'IngestValidationError';
  }
}

/**
 * Validate and parse external input to Zatoshi
 * This is the SINGLE entry point for external amounts
 *
 * @param input - External input (string, bigint, or number)
 * @param fieldName - Name of the field for error messages
 * @returns Validated Zatoshi
 * @throws IngestValidationError if input is invalid
 *
 * @example
 * ```typescript
 * // From API request (string)
 * const amount = parseZatoshiInput(req.body.amount, 'amount');
 *
 * // From internal code (bigint)
 * const fee = parseZatoshiInput(10000n, 'fee');
 * ```
 */
export function parseZatoshiInput(input: unknown, fieldName: string = 'amount'): Zatoshi {
  if (input === null || input === undefined) {
    throw new IngestValidationError(`${fieldName} is required`, fieldName, input);
  }

  let value: bigint;

  if (typeof input === 'string') {
    // Validate string is numeric (non-negative integer)
    if (!/^\d+$/.test(input)) {
      throw new IngestValidationError(
        `${fieldName} must be a non-negative integer string`,
        fieldName,
        input
      );
    }
    try {
      value = BigInt(input);
    } catch {
      throw new IngestValidationError(`${fieldName} is not a valid integer`, fieldName, input);
    }
  } else if (typeof input === 'bigint') {
    value = input;
  } else if (typeof input === 'number') {
    // Numbers are discouraged but accepted for backwards compatibility
    if (!Number.isFinite(input)) {
      throw new IngestValidationError(`${fieldName} must be a finite number`, fieldName, input);
    }
    if (!Number.isInteger(input)) {
      throw new IngestValidationError(
        `${fieldName} must be an integer (use string for precision)`,
        fieldName,
        input
      );
    }
    if (input < 0) {
      throw new IngestValidationError(`${fieldName} cannot be negative`, fieldName, input);
    }
    value = BigInt(Math.floor(input));
  } else {
    throw new IngestValidationError(
      `${fieldName} must be string, bigint, or number`,
      fieldName,
      input
    );
  }

  // Validate range
  if (value < 0n) {
    throw new IngestValidationError(`${fieldName} cannot be negative`, fieldName, input);
  }

  if (value > MAX_SUPPLY) {
    throw new IngestValidationError(
      `${fieldName} exceeds maximum ZEC supply`,
      fieldName,
      input
    );
  }

  return zatoshi(value);
}

/**
 * Validate a string is a valid Zcash address format
 */
export function validateAddressInput(
  input: unknown,
  fieldName: string = 'address'
): string {
  if (typeof input !== 'string') {
    throw new IngestValidationError(`${fieldName} must be a string`, fieldName, input);
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new IngestValidationError(`${fieldName} cannot be empty`, fieldName, input);
  }

  // Basic format validation - detailed validation happens in address-validator
  if (trimmed.length > 512) {
    throw new IngestValidationError(`${fieldName} is too long`, fieldName, input);
  }

  return trimmed;
}

/**
 * Validate a user ID string
 */
export function validateUserIdInput(input: unknown): string {
  if (typeof input !== 'string') {
    throw new IngestValidationError('userId must be a string', 'userId', input);
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new IngestValidationError('userId cannot be empty', 'userId', input);
  }

  if (trimmed.length > 256) {
    throw new IngestValidationError('userId is too long', 'userId', input);
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new IngestValidationError('userId contains invalid characters', 'userId', input);
  }

  return trimmed;
}
