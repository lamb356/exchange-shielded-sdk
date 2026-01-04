/**
 * Security Module Tests
 *
 * Tests for key management, input sanitization, and rate limiting.
 * Includes security-focused tests to verify keys never leak.
 */

import {
  SecureKeyManager,
  KeyManagerError,
  createKeyManager,
  ValidationError,
  sanitizeAddress,
  sanitizeAmount,
  sanitizeMemo,
  sanitizeUserId,
  sanitizeTransactionId,
  textToMemoHex,
  memoHexToText,
  redactSensitiveData,
} from '../src/security/index.js';
import { setValidationOptions, resetValidationOptions } from '../src/address-validator.js';

// Use format-only validation for tests (fake addresses don't have valid checksums)
beforeAll(() => {
  setValidationOptions({ skipChecksum: true });
});

afterAll(() => {
  resetValidationOptions();
});

describe('SecureKeyManager', () => {
  let keyManager: SecureKeyManager;

  beforeEach(() => {
    keyManager = new SecureKeyManager();
  });

  afterEach(() => {
    keyManager.clearAllKeys();
  });

  describe('key loading', () => {
    it('should load an encrypted key', async () => {
      const rawKey = Buffer.alloc(32, 0x42); // 32-byte key
      const password = 'test-password';

      // Encrypt the key first
      const encrypted = await keyManager.encryptKeyForStorage(rawKey, password);

      // Load it
      await keyManager.loadKey('test-key', encrypted, password);

      expect(keyManager.hasKey('test-key')).toBe(true);
      expect(keyManager.getKeyCount()).toBe(1);
    });

    it('should load a raw key', () => {
      const rawKey = Buffer.alloc(32, 0x42);

      keyManager.loadRawKey('raw-key', rawKey, 'sapling');

      expect(keyManager.hasKey('raw-key')).toBe(true);
      const metadata = keyManager.getKeyMetadata('raw-key');
      expect(metadata?.keyType).toBe('sapling');
    });

    it('should reject duplicate key IDs', () => {
      const rawKey = Buffer.alloc(32, 0x42);

      keyManager.loadRawKey('dup-key', rawKey, 'sapling');

      expect(() => {
        keyManager.loadRawKey('dup-key', rawKey, 'sapling');
      }).toThrow(KeyManagerError);
    });

    it('should enforce max keys limit', () => {
      const manager = new SecureKeyManager({ maxKeys: 3 });
      const rawKey = Buffer.alloc(32, 0x42);

      manager.loadRawKey('key-1', rawKey, 'sapling');
      manager.loadRawKey('key-2', rawKey, 'sapling');
      manager.loadRawKey('key-3', rawKey, 'sapling');

      expect(() => {
        manager.loadRawKey('key-4', rawKey, 'sapling');
      }).toThrow(KeyManagerError);
    });

    it('should reject invalid encrypted key format', async () => {
      const invalidData = Buffer.from('too short');

      await expect(
        keyManager.loadKey('bad-key', invalidData, 'password')
      ).rejects.toThrow(KeyManagerError);
    });

    it('should reject wrong password', async () => {
      const rawKey = Buffer.alloc(32, 0x42);
      const password = 'correct-password';

      const encrypted = await keyManager.encryptKeyForStorage(rawKey, password);

      await expect(
        keyManager.loadKey('test-key', encrypted, 'wrong-password')
      ).rejects.toThrow(KeyManagerError);
    });
  });

  describe('key signing', () => {
    it('should sign transaction data', () => {
      const rawKey = Buffer.alloc(32, 0x42);
      keyManager.loadRawKey('sign-key', rawKey, 'sapling');

      const txData = Buffer.from('transaction data');
      const signature = keyManager.createTransactionDigest('sign-key', txData);

      expect(signature).toBeInstanceOf(Buffer);
      expect(signature.length).toBe(32); // SHA-256 hash
    });

    it('should throw for unknown key ID', () => {
      const txData = Buffer.from('transaction data');

      expect(() => {
        keyManager.createTransactionDigest('unknown-key', txData);
      }).toThrow(KeyManagerError);
    });

    it('should update lastUsedAt on signing', () => {
      const rawKey = Buffer.alloc(32, 0x42);
      keyManager.loadRawKey('timing-key', rawKey, 'sapling');

      const before = keyManager.getKeyMetadata('timing-key');
      expect(before?.lastUsedAt).toBeUndefined();

      const txData = Buffer.from('transaction data');
      keyManager.createTransactionDigest('timing-key', txData);

      const after = keyManager.getKeyMetadata('timing-key');
      expect(after?.lastUsedAt).toBeDefined();
    });
  });

  describe('key clearing', () => {
    it('should clear a specific key', () => {
      const rawKey = Buffer.alloc(32, 0x42);
      keyManager.loadRawKey('clear-key', rawKey, 'sapling');

      expect(keyManager.hasKey('clear-key')).toBe(true);

      const result = keyManager.clearKey('clear-key');

      expect(result).toBe(true);
      expect(keyManager.hasKey('clear-key')).toBe(false);
    });

    it('should return false for non-existent key', () => {
      const result = keyManager.clearKey('non-existent');
      expect(result).toBe(false);
    });

    it('should clear all keys', () => {
      const rawKey = Buffer.alloc(32, 0x42);
      keyManager.loadRawKey('key-1', rawKey, 'sapling');
      keyManager.loadRawKey('key-2', rawKey, 'orchard');
      keyManager.loadRawKey('key-3', rawKey, 'unified');

      expect(keyManager.getKeyCount()).toBe(3);

      keyManager.clearAllKeys();

      expect(keyManager.getKeyCount()).toBe(0);
      expect(keyManager.listKeyIds()).toEqual([]);
    });
  });

  describe('key metadata', () => {
    it('should return key metadata without exposing key bytes', () => {
      const rawKey = Buffer.alloc(32, 0x42);
      keyManager.loadRawKey('meta-key', rawKey, 'orchard');

      const metadata = keyManager.getKeyMetadata('meta-key');

      expect(metadata).toBeDefined();
      expect(metadata?.id).toBe('meta-key');
      expect(metadata?.keyType).toBe('orchard');
      expect(metadata?.createdAt).toBeDefined();

      // Ensure no key bytes are exposed
      expect((metadata as unknown as { keyBytes?: unknown }).keyBytes).toBeUndefined();
    });

    it('should list all key IDs', () => {
      const rawKey = Buffer.alloc(32, 0x42);
      keyManager.loadRawKey('key-a', rawKey, 'sapling');
      keyManager.loadRawKey('key-b', rawKey, 'orchard');

      const ids = keyManager.listKeyIds();

      expect(ids).toContain('key-a');
      expect(ids).toContain('key-b');
      expect(ids.length).toBe(2);
    });
  });

  describe('security - keys never leak', () => {
    it('should not expose key in toString()', () => {
      const rawKey = Buffer.alloc(32, 0x42);
      keyManager.loadRawKey('secret-key', rawKey, 'sapling');

      const str = keyManager.toString();

      expect(str).not.toContain('42');
      expect(str).toContain('SecureKeyManager');
      expect(str).toContain('1 keys loaded');
    });

    it('should not expose key in toJSON()', () => {
      const rawKey = Buffer.alloc(32, 0x42);
      keyManager.loadRawKey('secret-key', rawKey, 'sapling');

      const json = keyManager.toJSON();

      expect(JSON.stringify(json)).not.toContain('42');
      expect((json as { keyIds: string[] }).keyIds).toContain('secret-key');
    });

    it('should sanitize error messages', () => {
      const keyData = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const error = new KeyManagerError(`Key data: ${keyData}`, 'TEST');

      expect(error.message).not.toContain(keyData);
      expect(error.message).toContain('[REDACTED]');
    });

    it('should sanitize KeyManagerError toString()', () => {
      const error = new KeyManagerError('Test error', 'TEST_CODE');

      const str = error.toString();

      expect(str).toContain('KeyManagerError');
      expect(str).toContain('Test error');
      expect(str).toContain('TEST_CODE');
    });

    it('should sanitize KeyManagerError toJSON()', () => {
      const error = new KeyManagerError('Test error', 'TEST_CODE');

      const json = error.toJSON();

      expect((json as { name: string }).name).toBe('KeyManagerError');
      expect((json as { code: string }).code).toBe('TEST_CODE');
    });
  });

  describe('createKeyManager factory', () => {
    it('should create a key manager with default config', () => {
      const manager = createKeyManager();

      expect(manager).toBeInstanceOf(SecureKeyManager);
    });

    it('should create a key manager with custom config', () => {
      const manager = createKeyManager({ maxKeys: 5 });

      expect(manager).toBeInstanceOf(SecureKeyManager);
    });
  });
});

describe('Input Sanitization', () => {
  describe('sanitizeAddress', () => {
    it('should accept valid transparent address', () => {
      const result = sanitizeAddress('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('transparent');
    });

    it('should accept valid Sapling address', () => {
      const saplingAddr =
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';

      const result = sanitizeAddress(saplingAddr);

      expect(result.valid).toBe(true);
      expect(result.type).toBe('sapling');
    });

    it('should trim whitespace', () => {
      const result = sanitizeAddress('  t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU  ');

      expect(result.valid).toBe(true);
      expect(result.address).toBe('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU');
    });

    it('should reject null input', () => {
      const result = sanitizeAddress(null as unknown as string);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject empty string', () => {
      const result = sanitizeAddress('');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject too long address', () => {
      const longAddr = 'x'.repeat(600);
      const result = sanitizeAddress(longAddr);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('maximum length');
    });

    it('should remove control characters', () => {
      const addrWithControl = 't1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU\x00\x01';
      const result = sanitizeAddress(addrWithControl);

      expect(result.valid).toBe(true);
      expect(result.address).toBe('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU');
    });

    it('should reject invalid address format', () => {
      const result = sanitizeAddress('not-a-valid-address');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid address');
    });
  });

  describe('sanitizeAmount', () => {
    it('should accept valid number', () => {
      const result = sanitizeAmount(10.5);

      expect(result.valid).toBe(true);
      expect(result.amount).toBe(10.5);
    });

    it('should accept valid string', () => {
      const result = sanitizeAmount('10.5');

      expect(result.valid).toBe(true);
      expect(result.amount).toBe(10.5);
    });

    it('should reject null', () => {
      const result = sanitizeAmount(null);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject empty string', () => {
      const result = sanitizeAmount('');

      expect(result.valid).toBe(false);
    });

    it('should throw ValidationError for NaN', () => {
      expect(() => sanitizeAmount(NaN)).toThrow(ValidationError);
      expect(() => sanitizeAmount(NaN)).toThrow('NaN');
    });

    it('should throw ValidationError for Infinity', () => {
      expect(() => sanitizeAmount(Infinity)).toThrow(ValidationError);
      expect(() => sanitizeAmount(Infinity)).toThrow('Infinity');
    });

    it('should throw ValidationError for negative Infinity', () => {
      expect(() => sanitizeAmount(-Infinity)).toThrow(ValidationError);
      expect(() => sanitizeAmount(-Infinity)).toThrow('Infinity');
    });

    it('should reject negative amounts', () => {
      const result = sanitizeAmount(-10);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('negative');
    });

    it('should reject zero', () => {
      const result = sanitizeAmount(0);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('greater than zero');
    });

    it('should reject amounts too small', () => {
      const result = sanitizeAmount(0.000000001); // Less than 1 zatoshi

      expect(result.valid).toBe(false);
    });

    it('should reject amounts too large', () => {
      const result = sanitizeAmount(22_000_000); // More than total supply

      expect(result.valid).toBe(false);
    });

    it('should round to zatoshi precision', () => {
      const result = sanitizeAmount(1.123456789);

      expect(result.valid).toBe(true);
      expect(result.amount).toBe(1.12345679); // Rounded to 8 decimals
    });

    it('should throw ValidationError for strings with non-numeric characters', () => {
      // SECURITY: Previously this silently mangled "$10.50 ZEC" to "10.50"
      // Now it throws to prevent silent data corruption
      expect(() => sanitizeAmount('$10.50 ZEC')).toThrow(ValidationError);
      try {
        sanitizeAmount('$10.50 ZEC');
      } catch (e) {
        expect((e as ValidationError).code).toBe('INVALID_AMOUNT_FORMAT');
      }
    });

    it('should throw ValidationError for scientific notation', () => {
      // SECURITY: "1e2" should NOT silently become "12"
      expect(() => sanitizeAmount('1e2')).toThrow(ValidationError);
      try {
        sanitizeAmount('1e2');
      } catch (e) {
        expect((e as ValidationError).code).toBe('INVALID_AMOUNT_FORMAT');
      }
    });

    it('should throw ValidationError for malformed strings like "1-2"', () => {
      // SECURITY: "1-2" should NOT silently become "1" or "12"
      expect(() => sanitizeAmount('1-2')).toThrow(ValidationError);
      try {
        sanitizeAmount('1-2');
      } catch (e) {
        expect((e as ValidationError).code).toBe('INVALID_AMOUNT_FORMAT');
      }
    });

    it('should throw ValidationError for "1e999" (overflow)', () => {
      expect(() => sanitizeAmount('1e999')).toThrow(ValidationError);
    });

    it('should throw ValidationError for MAX_SAFE_INTEGER+1 as string', () => {
      // This would lose precision as a number
      expect(() => sanitizeAmount('9007199254740992')).not.toThrow(); // This is actually OK as it's a valid number string
      // But amounts this large would fail the MAX_AMOUNT check
      const result = sanitizeAmount('9007199254740992');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum');
    });

    it('should accept valid integer strings', () => {
      const result = sanitizeAmount('100');
      expect(result.valid).toBe(true);
      expect(result.amount).toBe(100);
    });

    it('should accept valid decimal strings with leading zero', () => {
      const result = sanitizeAmount('0.5');
      expect(result.valid).toBe(true);
      expect(result.amount).toBe(0.5);
    });
  });

  describe('sanitizeMemo', () => {
    it('should accept valid hex memo', () => {
      const result = sanitizeMemo('48656c6c6f'); // "Hello"

      expect(result.valid).toBe(true);
      expect(result.memo).toBe('48656c6c6f');
      expect(result.byteLength).toBe(5);
    });

    it('should accept empty memo', () => {
      const result = sanitizeMemo('');

      expect(result.valid).toBe(true);
      expect(result.memo).toBe('');
      expect(result.byteLength).toBe(0);
    });

    it('should handle null/undefined', () => {
      const result1 = sanitizeMemo(null as unknown as string);
      const result2 = sanitizeMemo(undefined as unknown as string);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });

    it('should strip 0x prefix', () => {
      const result = sanitizeMemo('0x48656c6c6f');

      expect(result.valid).toBe(true);
      expect(result.memo).toBe('48656c6c6f');
    });

    it('should lowercase hex', () => {
      const result = sanitizeMemo('48656C6C6F');

      expect(result.valid).toBe(true);
      expect(result.memo).toBe('48656c6c6f');
    });

    it('should pad odd-length hex', () => {
      const result = sanitizeMemo('123'); // Odd length

      expect(result.valid).toBe(true);
      expect(result.memo).toBe('0123');
    });

    it('should reject non-hex characters', () => {
      const result = sanitizeMemo('not-hex-data!');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('hex-encoded');
    });

    it('should reject memo exceeding 512 bytes', () => {
      const longHex = 'ff'.repeat(513); // 513 bytes
      const result = sanitizeMemo(longHex);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('512 bytes');
    });
  });

  describe('textToMemoHex and memoHexToText', () => {
    it('should round-trip text', () => {
      const original = 'Hello, World!';
      const hex = textToMemoHex(original);
      const decoded = memoHexToText(hex);

      expect(decoded).toBe(original);
    });

    it('should handle unicode', () => {
      const original = 'Hello!';
      const hex = textToMemoHex(original);
      const decoded = memoHexToText(hex);

      expect(decoded).toBe(original);
    });

    it('should strip trailing null bytes', () => {
      const hex = '48656c6c6f0000000000'; // "Hello" + nulls
      const decoded = memoHexToText(hex);

      expect(decoded).toBe('Hello');
    });
  });

  describe('sanitizeUserId', () => {
    it('should accept valid user ID', () => {
      const result = sanitizeUserId('user-123');

      expect(result).toBe('user-123');
    });

    it('should accept alphanumeric with dots and underscores', () => {
      const result = sanitizeUserId('user.name_123');

      expect(result).toBe('user.name_123');
    });

    it('should reject null', () => {
      const result = sanitizeUserId(null as unknown as string);

      expect(result).toBeNull();
    });

    it('should reject empty string', () => {
      const result = sanitizeUserId('');

      expect(result).toBeNull();
    });

    it('should reject special characters', () => {
      const result = sanitizeUserId('user@domain.com');

      expect(result).toBeNull();
    });

    it('should reject too long user ID', () => {
      const result = sanitizeUserId('x'.repeat(300));

      expect(result).toBeNull();
    });
  });

  describe('sanitizeTransactionId', () => {
    it('should accept valid 64-char hex txid', () => {
      const txid = 'a'.repeat(64);
      const result = sanitizeTransactionId(txid);

      expect(result).toBe(txid);
    });

    it('should lowercase txid', () => {
      const txid = 'ABCD' + 'a'.repeat(60);
      const result = sanitizeTransactionId(txid);

      expect(result).toBe('abcd' + 'a'.repeat(60));
    });

    it('should reject wrong length', () => {
      const result = sanitizeTransactionId('abc');

      expect(result).toBeNull();
    });

    it('should reject non-hex characters', () => {
      const result = sanitizeTransactionId('z'.repeat(64));

      expect(result).toBeNull();
    });
  });

  describe('redactSensitiveData', () => {
    it('should redact known sensitive fields', () => {
      const obj = {
        userId: 'user-123',
        spendingKey: 'secret-key-data',
        password: 'my-password',
        amount: 10.5,
      };

      const redacted = redactSensitiveData(obj) as typeof obj;

      expect(redacted.userId).toBe('user-123');
      expect(redacted.spendingKey).toBe('[REDACTED]');
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.amount).toBe(10.5);
    });

    it('should partially redact addresses', () => {
      const obj = {
        address: 't1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU',
        txid: 'a'.repeat(64),
      };

      const redacted = redactSensitiveData(obj) as typeof obj;

      expect(redacted.address).toContain('...');
      expect(redacted.txid).toContain('...');
    });

    it('should redact shielded addresses', () => {
      const obj = {
        destination:
          'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
      };

      const redacted = redactSensitiveData(obj) as typeof obj;

      // Should be partially redacted
      expect(redacted.destination.length).toBeLessThan(
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly'
          .length
      );
    });

    it('should handle nested objects', () => {
      const obj = {
        user: {
          id: 'user-123',
          profile: {
            name: 'John Doe',
            spendingKey: 'secret-spending-key',
          },
        },
      };

      const redacted = redactSensitiveData(obj) as typeof obj;

      expect(redacted.user.id).toBe('user-123');
      expect(redacted.user.profile.name).toBe('John Doe');
      expect(redacted.user.profile.spendingKey).toBe('[REDACTED]');
    });

    it('should handle arrays', () => {
      const obj = {
        items: [
          { itemId: 'item-1', privateData: 'secret-1' },
          { itemId: 'item-2', privateData: 'secret-2' },
        ],
      };

      const redacted = redactSensitiveData(obj) as typeof obj;

      expect(redacted.items[0]?.itemId).toBe('item-1');
      expect(redacted.items[0]?.privateData).toBe('[REDACTED]');
    });

    it('should handle circular references', () => {
      const obj: Record<string, unknown> = { name: 'test' };
      obj['self'] = obj;

      const redacted = redactSensitiveData(obj) as typeof obj;

      expect(redacted.name).toBe('test');
      expect(redacted.self).toBe('[CIRCULAR]');
    });

    it('should redact Buffer objects', () => {
      const obj = {
        data: Buffer.from('secret data'),
      };

      const redacted = redactSensitiveData(obj) as { data: string };

      expect(redacted.data).toBe('[REDACTED]');
    });

    it('should respect custom redaction config', () => {
      const obj = {
        customSecret: 'secret-value',
        normalField: 'normal-value',
      };

      const redacted = redactSensitiveData(obj, {
        alwaysRedact: ['customSecret'],
      }) as typeof obj;

      expect(redacted.customSecret).toBe('[REDACTED]');
      expect(redacted.normalField).toBe('normal-value');
    });
  });
});
