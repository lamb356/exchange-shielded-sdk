/**
 * Amounts Module Tests
 *
 * Tests for ZEC/zatoshi conversion and validation utilities.
 */

import {
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
} from '../src/utils/amounts.js';

describe('Amount Constants', () => {
  it('should have correct ZATOSHIS_PER_ZEC', () => {
    expect(ZATOSHIS_PER_ZEC).toBe(100_000_000n);
  });

  it('should have correct MAX_ZATOSHIS (21 million ZEC)', () => {
    expect(MAX_ZATOSHIS).toBe(2_100_000_000_000_000n);
  });

  it('should have correct MIN_ZATOSHIS', () => {
    expect(MIN_ZATOSHIS).toBe(1n);
  });
});

describe('zecToZatoshis', () => {
  it('should convert 1 ZEC to 100 million zatoshis', () => {
    expect(zecToZatoshis(1)).toBe(100_000_000n);
  });

  it('should convert 0.5 ZEC correctly', () => {
    expect(zecToZatoshis(0.5)).toBe(50_000_000n);
  });

  it('should convert 0.00000001 ZEC (1 zatoshi) correctly', () => {
    expect(zecToZatoshis(0.00000001)).toBe(1n);
  });

  it('should convert 0 ZEC to 0 zatoshis', () => {
    expect(zecToZatoshis(0)).toBe(0n);
  });

  it('should handle floating-point precision for 1.23456789 ZEC', () => {
    expect(zecToZatoshis(1.23456789)).toBe(123_456_789n);
  });

  it('should throw AmountError for NaN', () => {
    expect(() => zecToZatoshis(NaN)).toThrow(AmountError);
    try {
      zecToZatoshis(NaN);
    } catch (e) {
      expect((e as AmountError).code).toBe('INVALID_ZEC_AMOUNT');
    }
  });

  it('should throw AmountError for Infinity', () => {
    expect(() => zecToZatoshis(Infinity)).toThrow(AmountError);
    try {
      zecToZatoshis(Infinity);
    } catch (e) {
      expect((e as AmountError).code).toBe('INFINITE_ZEC_AMOUNT');
    }
  });

  it('should throw AmountError for negative amounts', () => {
    expect(() => zecToZatoshis(-1)).toThrow(AmountError);
    try {
      zecToZatoshis(-1);
    } catch (e) {
      expect((e as AmountError).code).toBe('NEGATIVE_ZEC_AMOUNT');
    }
  });
});

describe('zatoshisToZec', () => {
  it('should convert 100 million zatoshis to 1 ZEC', () => {
    expect(zatoshisToZec(100_000_000n)).toBe(1);
  });

  it('should convert 50 million zatoshis to 0.5 ZEC', () => {
    expect(zatoshisToZec(50_000_000n)).toBe(0.5);
  });

  it('should convert 1 zatoshi to 0.00000001 ZEC', () => {
    expect(zatoshisToZec(1n)).toBe(0.00000001);
  });

  it('should convert 0 zatoshis to 0 ZEC', () => {
    expect(zatoshisToZec(0n)).toBe(0);
  });

  it('should throw AmountError for non-bigint input', () => {
    expect(() => zatoshisToZec(100 as unknown as bigint)).toThrow(AmountError);
  });

  it('should throw AmountError for negative zatoshis', () => {
    expect(() => zatoshisToZec(-1n)).toThrow(AmountError);
    try {
      zatoshisToZec(-1n);
    } catch (e) {
      expect((e as AmountError).code).toBe('NEGATIVE_ZATOSHIS');
    }
  });
});

describe('validateZatoshis', () => {
  it('should not throw for valid amount', () => {
    expect(() => validateZatoshis(100_000_000n)).not.toThrow();
  });

  it('should not throw for 0 zatoshis', () => {
    expect(() => validateZatoshis(0n)).not.toThrow();
  });

  it('should not throw for MAX_ZATOSHIS', () => {
    expect(() => validateZatoshis(MAX_ZATOSHIS)).not.toThrow();
  });

  it('should throw for negative amount', () => {
    expect(() => validateZatoshis(-1n)).toThrow(AmountError);
  });

  it('should throw for amount exceeding MAX_ZATOSHIS', () => {
    expect(() => validateZatoshis(MAX_ZATOSHIS + 1n)).toThrow(AmountError);
    try {
      validateZatoshis(MAX_ZATOSHIS + 1n);
    } catch (e) {
      expect((e as AmountError).code).toBe('EXCESSIVE_ZATOSHIS');
    }
  });

  it('should throw for non-bigint input', () => {
    expect(() => validateZatoshis(100 as unknown as bigint)).toThrow(AmountError);
  });
});

describe('validatePositiveZatoshis', () => {
  it('should not throw for positive amount', () => {
    expect(() => validatePositiveZatoshis(1n)).not.toThrow();
  });

  it('should throw for zero', () => {
    expect(() => validatePositiveZatoshis(0n)).toThrow(AmountError);
    try {
      validatePositiveZatoshis(0n);
    } catch (e) {
      expect((e as AmountError).code).toBe('ZERO_ZATOSHIS');
    }
  });

  it('should throw for negative amount', () => {
    expect(() => validatePositiveZatoshis(-1n)).toThrow(AmountError);
  });
});

describe('formatZatoshis', () => {
  it('should format with default options', () => {
    expect(formatZatoshis(150_000_000n)).toBe('1.50000000 ZEC');
  });

  it('should format without suffix', () => {
    expect(formatZatoshis(150_000_000n, { includeSuffix: false })).toBe('1.50000000');
  });

  it('should format with fewer decimals', () => {
    expect(formatZatoshis(150_000_000n, { decimals: 2 })).toBe('1.50 ZEC');
  });

  it('should format zero correctly', () => {
    expect(formatZatoshis(0n)).toBe('0.00000000 ZEC');
  });

  it('should format 1 zatoshi correctly', () => {
    expect(formatZatoshis(1n)).toBe('0.00000001 ZEC');
  });
});

describe('parseAmountToZatoshis', () => {
  it('should parse ZEC string to zatoshis', () => {
    expect(parseAmountToZatoshis('1.5')).toBe(150_000_000n);
  });

  it('should parse integer string', () => {
    expect(parseAmountToZatoshis('10')).toBe(1_000_000_000n);
  });

  it('should parse zatoshis directly when isZec=false', () => {
    expect(parseAmountToZatoshis('100000000', false)).toBe(100_000_000n);
  });

  it('should handle leading/trailing whitespace', () => {
    expect(parseAmountToZatoshis('  1.5  ')).toBe(150_000_000n);
  });

  it('should throw for empty string', () => {
    expect(() => parseAmountToZatoshis('')).toThrow(AmountError);
    try {
      parseAmountToZatoshis('');
    } catch (e) {
      expect((e as AmountError).code).toBe('EMPTY_AMOUNT_STRING');
    }
  });

  it('should throw for invalid format (scientific notation)', () => {
    expect(() => parseAmountToZatoshis('1e2')).toThrow(AmountError);
    try {
      parseAmountToZatoshis('1e2');
    } catch (e) {
      expect((e as AmountError).code).toBe('INVALID_AMOUNT_FORMAT');
    }
  });

  it('should throw for invalid format (special characters)', () => {
    expect(() => parseAmountToZatoshis('$10')).toThrow(AmountError);
  });

  it('should throw for negative ZEC', () => {
    expect(() => parseAmountToZatoshis('-1')).toThrow(AmountError);
  });
});

describe('addZatoshis', () => {
  it('should add two amounts', () => {
    expect(addZatoshis(100n, 200n)).toBe(300n);
  });

  it('should handle large amounts', () => {
    const a = 1_000_000_000_000_000n;
    const b = 500_000_000_000_000n;
    expect(addZatoshis(a, b)).toBe(1_500_000_000_000_000n);
  });

  it('should throw if result exceeds MAX_ZATOSHIS', () => {
    expect(() => addZatoshis(MAX_ZATOSHIS, 1n)).toThrow(AmountError);
  });
});

describe('subtractZatoshis', () => {
  it('should subtract two amounts', () => {
    expect(subtractZatoshis(300n, 100n)).toBe(200n);
  });

  it('should return 0 for equal amounts', () => {
    expect(subtractZatoshis(100n, 100n)).toBe(0n);
  });

  it('should throw if result would be negative', () => {
    expect(() => subtractZatoshis(100n, 200n)).toThrow(AmountError);
    try {
      subtractZatoshis(100n, 200n);
    } catch (e) {
      expect((e as AmountError).code).toBe('NEGATIVE_RESULT');
    }
  });
});

describe('AmountError', () => {
  it('should have correct properties', () => {
    const error = new AmountError('Test message', 'TEST_CODE');
    expect(error.name).toBe('AmountError');
    expect(error.message).toBe('Test message');
    expect(error.code).toBe('TEST_CODE');
  });
});
