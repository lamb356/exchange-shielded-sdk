import {
  zatoshi,
  zecToZatoshi,
  zatoshiToZec,
  zatoshiToString,
  stringToZatoshi,
  ONE_ZEC,
  MAX_SUPPLY,
  Zatoshi
} from '../src/types/money.js';
import { safeJsonStringify, safeJsonParse } from '../src/utils/amounts.js';

describe('Money Safety', () => {
  describe('Zatoshi type creation', () => {
    it('should create zatoshi from bigint', () => {
      const z = zatoshi(100n);
      expect(z).toBe(100n);
    });

    it('should reject negative zatoshis', () => {
      expect(() => zatoshi(-100n)).toThrow('cannot be negative');
    });

    it('should allow zero zatoshis', () => {
      expect(() => zatoshi(0n)).not.toThrow();
    });

    it('should create large zatoshi values', () => {
      const largeAmount = zatoshi(1_000_000_000_000n);
      expect(largeAmount).toBe(1_000_000_000_000n);
    });
  });

  describe('ZEC to Zatoshi conversion', () => {
    it('should convert 1 ZEC to 100_000_000 zatoshis', () => {
      expect(zecToZatoshi(1)).toBe(ONE_ZEC);
    });

    it('should convert 0.00000001 ZEC to 1 zatoshi', () => {
      expect(zecToZatoshi(0.00000001)).toBe(1n);
    });

    it('should handle floating-point precision', () => {
      // 0.1 + 0.2 = 0.30000000000000004 in JS
      // But we should get exactly 30_000_000 zatoshis
      expect(zecToZatoshi(0.1 + 0.2)).toBe(30_000_000n);
    });

    it('should reject negative ZEC', () => {
      expect(() => zecToZatoshi(-1)).toThrow();
    });

    it('should reject Infinity', () => {
      expect(() => zecToZatoshi(Infinity)).toThrow();
    });

    it('should reject NaN', () => {
      expect(() => zecToZatoshi(NaN)).toThrow();
    });

    it('should handle very small amounts correctly', () => {
      expect(zecToZatoshi(0.00000005)).toBe(5n);
    });

    it('should convert 0 ZEC to 0 zatoshis', () => {
      expect(zecToZatoshi(0)).toBe(0n);
    });

    it('should handle decimal ZEC amounts', () => {
      expect(zecToZatoshi(1.5)).toBe(150_000_000n);
      expect(zecToZatoshi(10.12345678)).toBe(1_012_345_678n);
    });
  });

  describe('Zatoshi to ZEC conversion', () => {
    it('should convert 100_000_000 zatoshis to 1 ZEC', () => {
      expect(zatoshiToZec(ONE_ZEC)).toBe(1);
    });

    it('should convert 1 zatoshi to 0.00000001 ZEC', () => {
      expect(zatoshiToZec(zatoshi(1n))).toBe(0.00000001);
    });

    it('should convert 0 zatoshis to 0 ZEC', () => {
      expect(zatoshiToZec(zatoshi(0n))).toBe(0);
    });

    it('should handle large amounts', () => {
      const z = zatoshi(21_000_000_00000000n); // 21 million ZEC
      expect(zatoshiToZec(z)).toBe(21_000_000);
    });
  });

  describe('String serialization', () => {
    it('should convert zatoshi to string', () => {
      const z = zatoshi(150_000_000n);
      const str = zatoshiToString(z);
      expect(typeof str).toBe('string');
      expect(str).toBe('150000000');
    });

    it('should round-trip through string', () => {
      const original = zatoshi(123_456_789n);
      const str = zatoshiToString(original);
      const restored = stringToZatoshi(str);
      expect(restored).toBe(original);
    });

    it('should reject invalid string', () => {
      expect(() => stringToZatoshi('not-a-number')).toThrow();
    });

    it('should reject negative string values', () => {
      expect(() => stringToZatoshi('-100')).toThrow('cannot be negative');
    });

    it('should handle zero string', () => {
      const z = stringToZatoshi('0');
      expect(z).toBe(0n);
    });

    it('should handle large string values', () => {
      const largeStr = '2100000000000000'; // MAX_SUPPLY
      const z = stringToZatoshi(largeStr);
      expect(z).toBe(MAX_SUPPLY);
    });
  });

  describe('JSON serialization', () => {
    it('should safely stringify objects with bigint', () => {
      const obj = { amount: zatoshi(100n), name: 'test' };
      const json = safeJsonStringify(obj);
      expect(json).toBe('{"amount":"100","name":"test"}');
    });

    it('should parse JSON with zatoshi keys', () => {
      const json = '{"amount":"150000000","fee":"10000"}';
      const parsed = safeJsonParse<{ amount: bigint; fee: bigint }>(
        json,
        ['amount', 'fee']
      );
      expect(parsed.amount).toBe(150_000_000n);
      expect(parsed.fee).toBe(10_000n);
    });

    it('should throw when JSON.stringify used directly on bigint', () => {
      const obj = { amount: 100n };
      expect(() => JSON.stringify(obj)).toThrow();
    });

    it('should handle nested objects with bigint', () => {
      const obj = {
        withdrawal: {
          amount: zatoshi(500_000_000n),
          fee: zatoshi(10_000n),
        },
        userId: 'user-123',
      };
      const json = safeJsonStringify(obj);
      expect(json).toContain('"amount":"500000000"');
      expect(json).toContain('"fee":"10000"');
    });

    it('should handle arrays with bigint', () => {
      const arr = [zatoshi(100n), zatoshi(200n), zatoshi(300n)];
      const json = safeJsonStringify(arr);
      expect(json).toBe('["100","200","300"]');
    });

    it('should not convert non-zatoshi string keys', () => {
      const json = '{"amount":"150000000","name":"test"}';
      const parsed = safeJsonParse<{ amount: bigint; name: string }>(
        json,
        ['amount']
      );
      expect(parsed.amount).toBe(150_000_000n);
      expect(parsed.name).toBe('test');
    });

    it('should not convert non-numeric strings to bigint', () => {
      const json = '{"amount":"abc","value":"123"}';
      const parsed = safeJsonParse<{ amount: string; value: bigint }>(
        json,
        ['amount', 'value']
      );
      // 'abc' does not match /^\d+$/ so it should remain a string
      expect(parsed.amount).toBe('abc');
      expect(parsed.value).toBe(123n);
    });
  });

  describe('RPC boundary conversion', () => {
    it('should convert to exactly 8 decimal places', () => {
      const convert = (z: Zatoshi) => (Number(z) / 100_000_000).toFixed(8);

      expect(convert(zatoshi(1n))).toBe('0.00000001');
      expect(convert(ONE_ZEC)).toBe('1.00000000');
      expect(convert(zatoshi(150_000_000n))).toBe('1.50000000');
      expect(convert(zatoshi(123_456_789n))).toBe('1.23456789');
    });

    it('should handle edge cases for RPC format', () => {
      const convert = (z: Zatoshi) => (Number(z) / 100_000_000).toFixed(8);

      expect(convert(zatoshi(0n))).toBe('0.00000000');
      expect(convert(zatoshi(99_999_999n))).toBe('0.99999999');
      expect(convert(zatoshi(100_000_001n))).toBe('1.00000001');
    });
  });

  describe('Constants', () => {
    it('should have correct ONE_ZEC', () => {
      expect(ONE_ZEC).toBe(100_000_000n);
    });

    it('should have correct MAX_SUPPLY', () => {
      expect(MAX_SUPPLY).toBe(2_100_000_000_000_000n);
    });

    it('should verify MAX_SUPPLY is 21 million ZEC', () => {
      expect(zatoshiToZec(MAX_SUPPLY)).toBe(21_000_000);
    });
  });

  describe('Type safety edge cases', () => {
    it('should handle arithmetic with zatoshi values', () => {
      const a = zatoshi(100_000_000n);
      const b = zatoshi(50_000_000n);
      // Note: arithmetic result needs to be re-wrapped for type safety
      const sum = zatoshi(a + b);
      const diff = zatoshi(a - b);
      expect(sum).toBe(150_000_000n);
      expect(diff).toBe(50_000_000n);
    });

    it('should handle comparison operations', () => {
      const a = zatoshi(100n);
      const b = zatoshi(200n);
      expect(a < b).toBe(true);
      expect(a > b).toBe(false);
      expect(a === zatoshi(100n)).toBe(true);
    });

    it('should round-trip ZEC -> Zatoshi -> ZEC', () => {
      const testValues = [0, 0.00000001, 0.5, 1, 1.5, 10, 100.12345678];
      for (const zec of testValues) {
        const z = zecToZatoshi(zec);
        const backToZec = zatoshiToZec(z);
        expect(backToZec).toBeCloseTo(zec, 8);
      }
    });
  });

  describe('Precision edge cases', () => {
    it('should handle JS floating-point quirks', () => {
      // Famous floating-point precision issues
      expect(zecToZatoshi(0.1)).toBe(10_000_000n);
      expect(zecToZatoshi(0.2)).toBe(20_000_000n);
      expect(zecToZatoshi(0.1 + 0.2)).toBe(30_000_000n);
      expect(zecToZatoshi(0.3)).toBe(30_000_000n);
    });

    it('should correctly round near-boundary values', () => {
      // Values that might cause rounding issues
      expect(zecToZatoshi(0.999999999)).toBe(100_000_000n); // Rounds to 1 ZEC
      expect(zecToZatoshi(0.000000005)).toBe(1n); // Rounds to 1 zatoshi
      expect(zecToZatoshi(0.000000004)).toBe(0n); // Rounds to 0 zatoshis
    });
  });
});
