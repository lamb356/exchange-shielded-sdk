/**
 * Tests for Address Validator Module
 *
 * Note: Most tests use skipChecksum mode for format validation testing.
 * Production code validates real checksums by default.
 */

import {
  validateAddress,
  isShielded,
  parseUnifiedAddress,
  validateAddressDetailed,
  getAddressPrefixes,
  setValidationOptions,
  resetValidationOptions,
  AddressType,
} from '../src/address-validator.js';

describe('AddressValidator', () => {
  // Use format-only validation for most tests (fake addresses don't have valid checksums)
  beforeAll(() => {
    setValidationOptions({ skipChecksum: true });
  });

  afterAll(() => {
    resetValidationOptions();
  });
  describe('validateAddress', () => {
    describe('Transparent addresses (t1/t3)', () => {
      it('should validate mainnet P2PKH address (t1)', () => {
        // Valid t1 address format (35 chars, Base58)
        const address = 't1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU';
        expect(validateAddress(address)).toBe('transparent');
      });

      it('should validate mainnet P2SH address (t3)', () => {
        // Valid t3 address format (35 chars, Base58)
        const address = 't3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd';
        expect(validateAddress(address)).toBe('transparent');
      });

      it('should validate testnet P2PKH address (tm)', () => {
        const address = 'tmQP9L3s31cLsghVYf2Jb5MhKj1o8Lxasri';
        expect(validateAddress(address)).toBe('transparent');
      });

      it('should validate testnet P2SH address (t2)', () => {
        const address = 't2UNzUUx8mWBCRYPRezvA363EYXyEpHokyi';
        expect(validateAddress(address)).toBe('transparent');
      });

      it('should reject transparent address with wrong length', () => {
        const address = 't1Rv4exT7bqhZqi2j7xz8bUHDMx'; // too short
        expect(validateAddress(address)).toBe('unknown');
      });

      it('should reject transparent address with invalid characters', () => {
        // Contains 'O' which is not in Base58 alphabet
        const address = 't1Rv4exT7bqhZqi2j7xz8bUHDMxwOsrjADU';
        expect(validateAddress(address)).toBe('unknown');
      });
    });

    describe('Sprout addresses (zc/zt)', () => {
      it('should validate mainnet Sprout address (zc)', () => {
        // Valid zc address format (95 chars, Base58)
        // zc prefix + 93 Base58 chars = 95 total
        const address =
          'zcRYvLiURno1LhXq95e8avXFcH2fKKToSLfcMoRBGCKbZ6vQJTWyHQYKZhZFVCFskNxXFXN3VVNYExfWBvnwLUpN6V2gXYZ';
        expect(address.length).toBe(95);
        expect(validateAddress(address)).toBe('sprout');
      });

      it('should validate testnet Sprout address (zt)', () => {
        // Valid zt address format (95 chars, Base58)
        const address =
          'ztRYvLiURno1LhXq95e8avXFcH2fKKToSLfcMoRBGCKbZ6vQJTWyHQYKZhZFVCFskNxXFXN3VVNYExfWBvnwLUpN6V2gXYZ';
        expect(address.length).toBe(95);
        expect(validateAddress(address)).toBe('sprout');
      });

      it('should reject Sprout address with wrong length', () => {
        const address = 'zcRYvLiURno1LhXq95e8avXFcH2fKKToSLfc'; // too short
        expect(validateAddress(address)).toBe('unknown');
      });
    });

    describe('Sapling addresses (zs)', () => {
      it('should validate mainnet Sapling address (zs)', () => {
        // Valid zs address format (Bech32, ~78 chars)
        const address =
          'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';
        expect(validateAddress(address)).toBe('sapling');
      });

      it('should validate testnet Sapling address (ztestsapling)', () => {
        const address =
          'ztestsapling1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slx';
        expect(validateAddress(address)).toBe('sapling');
      });

      it('should handle Sapling address with mixed case (Bech32 is case-insensitive)', () => {
        // Bech32 should not have mixed case
        const address =
          'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9SLY';
        expect(validateAddress(address)).toBe('unknown');
      });
    });

    describe('Unified addresses (u1)', () => {
      it('should validate mainnet Unified address (u1)', () => {
        // Valid u1 address format (Bech32m, variable length)
        const address =
          'u1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty6q8n7qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk7cyxv';
        expect(validateAddress(address)).toBe('unified');
      });

      it('should validate testnet Unified address (utest)', () => {
        const address =
          'utest1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty6q8n7qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzh5yy6';
        expect(validateAddress(address)).toBe('unified');
      });

      it('should reject unified address that is too short', () => {
        const address = 'u1abc123';
        expect(validateAddress(address)).toBe('unknown');
      });
    });

    describe('Edge cases', () => {
      it('should return unknown for empty string', () => {
        expect(validateAddress('')).toBe('unknown');
      });

      it('should return unknown for null/undefined', () => {
        expect(validateAddress(null as unknown as string)).toBe('unknown');
        expect(validateAddress(undefined as unknown as string)).toBe('unknown');
      });

      it('should return unknown for whitespace-only string', () => {
        expect(validateAddress('   ')).toBe('unknown');
      });

      it('should handle addresses with leading/trailing whitespace', () => {
        const address = '  t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU  ';
        expect(validateAddress(address)).toBe('transparent');
      });

      it('should return unknown for random string', () => {
        expect(validateAddress('not-an-address')).toBe('unknown');
      });

      it('should return unknown for Bitcoin address', () => {
        // Bitcoin P2PKH address
        expect(validateAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe('unknown');
        // Bitcoin Bech32 address
        expect(validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('unknown');
      });
    });
  });

  describe('isShielded', () => {
    it('should return false for transparent addresses', () => {
      expect(isShielded('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU')).toBe(false);
      expect(isShielded('t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd')).toBe(false);
    });

    it('should return true for Sprout addresses', () => {
      // 95 character Sprout address
      const address =
        'zcRYvLiURno1LhXq95e8avXFcH2fKKToSLfcMoRBGCKbZ6vQJTWyHQYKZhZFVCFskNxXFXN3VVNYExfWBvnwLUpN6V2gXYZ';
      expect(isShielded(address)).toBe(true);
    });

    it('should return true for Sapling addresses', () => {
      const address =
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';
      expect(isShielded(address)).toBe(true);
    });

    it('should return true for Unified addresses', () => {
      const address =
        'u1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty6q8n7qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk7cyxv';
      expect(isShielded(address)).toBe(true);
    });

    it('should return false for invalid addresses', () => {
      expect(isShielded('invalid')).toBe(false);
      expect(isShielded('')).toBe(false);
    });
  });

  describe('parseUnifiedAddress', () => {
    it('should return orchard: true for valid unified address', () => {
      const address =
        'u1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty6q8n7qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk7cyxv';
      const components = parseUnifiedAddress(address);

      expect(components.unified).toBe(true);
      expect(components.receivers).toBe('unknown');
      expect(components.sapling).toBeUndefined();
      expect(components.transparent).toBeUndefined();
    });

    it('should return empty object for non-unified address', () => {
      const address = 't1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU';
      const components = parseUnifiedAddress(address);

      expect(components).toEqual({});
    });

    it('should return empty object for Sapling address', () => {
      const address =
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';
      const components = parseUnifiedAddress(address);

      expect(components).toEqual({});
    });

    it('should return empty object for invalid address', () => {
      expect(parseUnifiedAddress('invalid')).toEqual({});
      expect(parseUnifiedAddress('')).toEqual({});
    });
  });

  describe('validateAddressDetailed', () => {
    it('should return detailed info for transparent mainnet address', () => {
      const result = validateAddressDetailed('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('transparent');
      expect(result.shielded).toBe(false);
      expect(result.network).toBe('mainnet');
      expect(result.error).toBeUndefined();
    });

    it('should return detailed info for transparent testnet address', () => {
      const result = validateAddressDetailed('tmQP9L3s31cLsghVYf2Jb5MhKj1o8Lxasri');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('transparent');
      expect(result.shielded).toBe(false);
      expect(result.network).toBe('testnet');
    });

    it('should return detailed info for Sapling mainnet address', () => {
      const address =
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';
      const result = validateAddressDetailed(address);

      expect(result.valid).toBe(true);
      expect(result.type).toBe('sapling');
      expect(result.shielded).toBe(true);
      expect(result.network).toBe('mainnet');
    });

    it('should return detailed info for Unified mainnet address', () => {
      const address =
        'u1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty6q8n7qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk7cyxv';
      const result = validateAddressDetailed(address);

      expect(result.valid).toBe(true);
      expect(result.type).toBe('unified');
      expect(result.shielded).toBe(true);
      expect(result.network).toBe('mainnet');
    });

    it('should return error for empty string', () => {
      const result = validateAddressDetailed('');

      expect(result.valid).toBe(false);
      expect(result.type).toBe('unknown');
      // Empty string is falsy, so caught by first check
      expect(result.error).toBe('Address must be a non-empty string');
    });

    it('should return error for whitespace-only string', () => {
      const result = validateAddressDetailed('   ');

      expect(result.valid).toBe(false);
      expect(result.type).toBe('unknown');
      expect(result.error).toBe('Address cannot be empty');
    });

    it('should return error for null/undefined', () => {
      const result = validateAddressDetailed(null as unknown as string);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Address must be a non-empty string');
    });

    it('should return error for unrecognized format', () => {
      const result = validateAddressDetailed('invalid-address');

      expect(result.valid).toBe(false);
      expect(result.type).toBe('unknown');
      expect(result.error).toBe('Unrecognized address format or invalid checksum');
    });
  });

  describe('getAddressPrefixes', () => {
    it('should return correct prefixes for transparent mainnet', () => {
      const prefixes = getAddressPrefixes('transparent', 'mainnet');
      expect(prefixes).toEqual(['t1', 't3']);
    });

    it('should return correct prefixes for transparent testnet', () => {
      const prefixes = getAddressPrefixes('transparent', 'testnet');
      expect(prefixes).toEqual(['tm', 't2']);
    });

    it('should return correct prefixes for Sprout mainnet', () => {
      const prefixes = getAddressPrefixes('sprout', 'mainnet');
      expect(prefixes).toEqual(['zc']);
    });

    it('should return correct prefixes for Sprout testnet', () => {
      const prefixes = getAddressPrefixes('sprout', 'testnet');
      expect(prefixes).toEqual(['zt']);
    });

    it('should return correct prefixes for Sapling mainnet', () => {
      const prefixes = getAddressPrefixes('sapling', 'mainnet');
      expect(prefixes).toEqual(['zs']);
    });

    it('should return correct prefixes for Sapling testnet', () => {
      const prefixes = getAddressPrefixes('sapling', 'testnet');
      expect(prefixes).toEqual(['ztestsapling']);
    });

    it('should return correct prefixes for Unified mainnet', () => {
      const prefixes = getAddressPrefixes('unified', 'mainnet');
      expect(prefixes).toEqual(['u1']);
    });

    it('should return correct prefixes for Unified testnet', () => {
      const prefixes = getAddressPrefixes('unified', 'testnet');
      expect(prefixes).toEqual(['utest']);
    });

    it('should default to mainnet when network not specified', () => {
      const prefixes = getAddressPrefixes('sapling');
      expect(prefixes).toEqual(['zs']);
    });
  });

  describe('Address type consistency', () => {
    const addressTypes: AddressType[] = [
      'transparent',
      'sprout',
      'sapling',
      'orchard',
      'unified',
      'unknown',
    ];

    it('should have all expected address types', () => {
      // Test that validateAddress returns known types
      const results = [
        validateAddress('t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU'),
        validateAddress(
          'zcRYvLiURno1LhXq95e8avXFcH2fKKToSLfcMoRBGCKbZ6vQJTWyHQYKZhZFVCFskNxXFXN3VVNYExfWBvnwLUpN6V2gXYZ'
        ),
        validateAddress(
          'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly'
        ),
        validateAddress(
          'u1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty6q8n7qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk7cyxv'
        ),
        validateAddress('invalid'),
      ];

      results.forEach((result) => {
        expect(addressTypes).toContain(result);
      });
    });
  });
});
