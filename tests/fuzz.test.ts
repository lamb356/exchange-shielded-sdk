/**
 * Fuzz Tests
 *
 * Tests for edge cases and malformed inputs to ensure the SDK handles
 * unexpected data gracefully without crashing or misbehaving.
 */

import {
  sanitizeAddress,
  sanitizeAmount,
  sanitizeMemo,
  ValidationError,
} from '../src/security/index.js';

describe('Address Fuzzing', () => {
  describe('Unicode and special characters', () => {
    it('should reject addresses with Unicode characters', () => {
      const result = sanitizeAddress('zs1\u0000null');
      expect(result.valid).toBe(false);
    });

    it('should reject addresses with emoji', () => {
      const result = sanitizeAddress('zs1test\u{1F4B0}');
      expect(result.valid).toBe(false);
    });

    it('should reject addresses with control characters', () => {
      const controlChars = [
        '\x00', // NULL
        '\x01', // SOH
        '\x7F', // DEL
        '\t',   // TAB
        '\n',   // LF
        '\r',   // CR
      ];

      for (const char of controlChars) {
        const result = sanitizeAddress(`zs1test${char}address`);
        expect(result.valid).toBe(false);
      }
    });

    it('should reject addresses with RTL override characters', () => {
      // Right-to-left override could be used to disguise addresses
      const result = sanitizeAddress('zs1test\u202Eaddress');
      expect(result.valid).toBe(false);
    });

    it('should reject addresses with zero-width characters', () => {
      const zeroWidth = [
        '\u200B', // Zero-width space
        '\u200C', // Zero-width non-joiner
        '\u200D', // Zero-width joiner
        '\uFEFF', // BOM
      ];

      for (const char of zeroWidth) {
        const result = sanitizeAddress(`zs1test${char}address`);
        expect(result.valid).toBe(false);
      }
    });
  });

  describe('Huge strings', () => {
    it('should reject addresses larger than 10KB', () => {
      const hugeAddress = 'zs1' + 'a'.repeat(10 * 1024);
      const result = sanitizeAddress(hugeAddress);
      expect(result.valid).toBe(false);
    });

    it('should reject addresses larger than 1MB', () => {
      const massiveAddress = 'zs1' + 'a'.repeat(1024 * 1024);
      const result = sanitizeAddress(massiveAddress);
      expect(result.valid).toBe(false);
    });
  });

  describe('Null bytes', () => {
    it('should reject addresses with embedded null bytes', () => {
      const result = sanitizeAddress('zs1test\x00address');
      expect(result.valid).toBe(false);
    });

    it('should reject addresses starting with null byte', () => {
      const result = sanitizeAddress('\x00zs1testaddress');
      expect(result.valid).toBe(false);
    });
  });

  describe('HTML/Script injection', () => {
    it('should reject addresses with HTML tags', () => {
      const result = sanitizeAddress('zs1<script>alert(1)</script>');
      expect(result.valid).toBe(false);
    });

    it('should reject addresses with URL encoding', () => {
      const result = sanitizeAddress('zs1%3Cscript%3Ealert(1)');
      expect(result.valid).toBe(false);
    });
  });
});

describe('Amount Fuzzing', () => {
  describe('Scientific notation', () => {
    it('should throw for positive scientific notation', () => {
      expect(() => sanitizeAmount('1e2')).toThrow(ValidationError);
      expect(() => sanitizeAmount('1E2')).toThrow(ValidationError);
    });

    it('should throw for negative exponent', () => {
      expect(() => sanitizeAmount('1e-2')).toThrow(ValidationError);
    });

    it('should throw for extreme scientific notation', () => {
      expect(() => sanitizeAmount('1e999')).toThrow(ValidationError);
      expect(() => sanitizeAmount('1e-999')).toThrow(ValidationError);
    });
  });

  describe('Negative values', () => {
    it('should reject negative amounts', () => {
      const result = sanitizeAmount(-1);
      expect(result.valid).toBe(false);
    });

    it('should reject negative string amounts (after parsing)', () => {
      const result = sanitizeAmount('-1');
      expect(result.valid).toBe(false);
    });
  });

  describe('Special floating-point values', () => {
    it('should throw for NaN', () => {
      expect(() => sanitizeAmount(NaN)).toThrow(ValidationError);
    });

    it('should throw for Infinity', () => {
      expect(() => sanitizeAmount(Infinity)).toThrow(ValidationError);
    });

    it('should throw for negative Infinity', () => {
      expect(() => sanitizeAmount(-Infinity)).toThrow(ValidationError);
    });
  });

  describe('MAX_SAFE_INTEGER boundary', () => {
    it('should handle MAX_SAFE_INTEGER', () => {
      // This should fail due to exceeding MAX_AMOUNT, not due to precision loss
      const result = sanitizeAmount(Number.MAX_SAFE_INTEGER);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });

    it('should handle MAX_SAFE_INTEGER + 1', () => {
      const result = sanitizeAmount(Number.MAX_SAFE_INTEGER + 1);
      expect(result.valid).toBe(false);
    });
  });

  describe('Malformed strings', () => {
    it('should throw for "1-2" (embedded minus)', () => {
      expect(() => sanitizeAmount('1-2')).toThrow(ValidationError);
    });

    it('should throw for multiple decimal points', () => {
      expect(() => sanitizeAmount('1.2.3')).toThrow(ValidationError);
    });

    it('should throw for currency symbols', () => {
      expect(() => sanitizeAmount('$100')).toThrow(ValidationError);
    });

    it('should throw for comma separators', () => {
      expect(() => sanitizeAmount('1,000')).toThrow(ValidationError);
    });

    it('should throw for leading/trailing dots only', () => {
      // This should still parse, just checking edge cases
      const result = sanitizeAmount('.5');
      expect(result.valid).toBe(true);
      expect(result.amount).toBe(0.5);
    });
  });

  describe('Edge values', () => {
    it('should reject zero', () => {
      const result = sanitizeAmount(0);
      expect(result.valid).toBe(false);
    });

    it('should reject amounts below minimum (dust)', () => {
      const result = sanitizeAmount(0.000000001);
      expect(result.valid).toBe(false);
    });

    it('should accept minimum valid amount', () => {
      const result = sanitizeAmount(0.00000001);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Memo Fuzzing (hex-encoded)', () => {
  // Note: sanitizeMemo expects hex-encoded input, not plain text
  // The 512-byte limit applies to decoded bytes (1024 hex chars max)

  describe('Valid hex input', () => {
    it('should accept valid hex memo', () => {
      const result = sanitizeMemo('48656c6c6f'); // "Hello" in hex
      expect(result.valid).toBe(true);
      expect(result.memo).toBe('48656c6c6f');
    });

    it('should accept empty memo', () => {
      const result = sanitizeMemo('');
      expect(result.valid).toBe(true);
    });

    it('should accept 0x prefix', () => {
      const result = sanitizeMemo('0x48656c6c6f');
      expect(result.valid).toBe(true);
      expect(result.memo).toBe('48656c6c6f');
    });
  });

  describe('Invalid hex input', () => {
    it('should reject non-hex characters', () => {
      const result = sanitizeMemo('hello'); // 'l' and 'o' are not valid hex
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hex');
    });

    it('should reject emoji (not hex)', () => {
      const result = sanitizeMemo('\u{1F4B0}');
      expect(result.valid).toBe(false);
    });

    it('should reject HTML tags (not hex)', () => {
      const result = sanitizeMemo('<script>');
      expect(result.valid).toBe(false);
    });
  });

  describe('Long memos', () => {
    it('should reject memo longer than 512 bytes (1024 hex chars)', () => {
      // 513 bytes = 1026 hex characters
      const longMemo = 'aa'.repeat(513);
      const result = sanitizeMemo(longMemo);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('512');
    });

    it('should accept memo exactly 512 bytes (1024 hex chars)', () => {
      // 512 bytes = 1024 hex characters
      const maxMemo = 'aa'.repeat(512);
      const result = sanitizeMemo(maxMemo);
      expect(result.valid).toBe(true);
      expect(result.byteLength).toBe(512);
    });
  });

  describe('Binary data as hex', () => {
    it('should handle null bytes in hex', () => {
      const result = sanitizeMemo('0000ffff');
      expect(result.valid).toBe(true);
    });

    it('should handle all-zeros', () => {
      const result = sanitizeMemo('00'.repeat(100));
      expect(result.valid).toBe(true);
    });

    it('should handle all-ones (0xff)', () => {
      const result = sanitizeMemo('ff'.repeat(100));
      expect(result.valid).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle odd-length hex (pads with leading zero)', () => {
      const result = sanitizeMemo('abc'); // 3 chars -> 0abc
      expect(result.valid).toBe(true);
      expect(result.byteLength).toBe(2);
    });

    it('should normalize to lowercase', () => {
      const result = sanitizeMemo('ABCDEF');
      expect(result.memo).toBe('abcdef');
    });
  });
});

describe('Type Coercion Attacks', () => {
  it('should handle object toString with address', () => {
    const malicious = {
      toString: () => 'zs1fake',
    };
    const result = sanitizeAddress(malicious as unknown as string);
    expect(result.valid).toBe(false);
  });

  it('should handle array input for amount', () => {
    const result = sanitizeAmount([100] as unknown as number);
    expect(result.valid).toBe(false);
  });

  it('should handle object input for amount', () => {
    const result = sanitizeAmount({ value: 100 } as unknown as number);
    expect(result.valid).toBe(false);
  });

  it('should handle boolean input for amount', () => {
    const result = sanitizeAmount(true as unknown as number);
    expect(result.valid).toBe(false);
  });
});
