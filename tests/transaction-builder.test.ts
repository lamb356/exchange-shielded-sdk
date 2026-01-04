/**
 * Tests for Shielded Transaction Builder Module
 *
 * All amounts are in zatoshis (1 ZEC = 100_000_000 zatoshis).
 */

import {
  ShieldedTransactionBuilder,
  TransactionBuilderError,
  ZIP317,
  calculateTransparentActions,
  calculateSaplingActions,
  calculateOrchardActions,
  calculateLogicalActions,
  calculateConventionalFee,
  estimateTransactionFee,
  PendingTransaction,
  ZSendmanyRequest,
  FeeEstimateOptions,
} from '../src/transaction-builder.js';
import { setValidationOptions, resetValidationOptions } from '../src/address-validator.js';

// Helper constant for zatoshis (1 ZEC = 100_000_000 zatoshis)
const ZAT = 100_000_000n;

// Use format-only validation for tests (fake addresses don't have valid checksums)
beforeAll(() => {
  setValidationOptions({ skipChecksum: true });
});

afterAll(() => {
  resetValidationOptions();
});

describe('ZIP317 Fee Estimation', () => {
  describe('calculateTransparentActions', () => {
    it('should return 0 for no inputs or outputs', () => {
      expect(calculateTransparentActions(0, 0)).toBe(0);
    });

    it('should return input count when inputs > outputs', () => {
      expect(calculateTransparentActions(3, 1)).toBe(3);
    });

    it('should return output count when outputs > inputs', () => {
      expect(calculateTransparentActions(1, 5)).toBe(5);
    });

    it('should handle equal inputs and outputs', () => {
      expect(calculateTransparentActions(2, 2)).toBe(2);
    });
  });

  describe('calculateSaplingActions', () => {
    it('should return 0 for no spends or outputs', () => {
      expect(calculateSaplingActions(0, 0)).toBe(0);
    });

    it('should return max of spends and outputs', () => {
      expect(calculateSaplingActions(2, 3)).toBe(3);
      expect(calculateSaplingActions(5, 2)).toBe(5);
      expect(calculateSaplingActions(3, 3)).toBe(3);
    });
  });

  describe('calculateOrchardActions', () => {
    it('should return the action count directly', () => {
      expect(calculateOrchardActions(0)).toBe(0);
      expect(calculateOrchardActions(5)).toBe(5);
      expect(calculateOrchardActions(100)).toBe(100);
    });
  });

  describe('calculateLogicalActions', () => {
    it('should sum all action types', () => {
      const options: FeeEstimateOptions = {
        transparentInputs: 2,
        transparentOutputs: 1,
        saplingSpends: 3,
        saplingOutputs: 2,
        orchardActions: 1,
      };

      // transparent: max(2, 1) = 2
      // sapling: max(3, 2) = 3
      // orchard: 1
      // total: 2 + 3 + 1 = 6
      expect(calculateLogicalActions(options)).toBe(6);
    });

    it('should handle default values', () => {
      expect(calculateLogicalActions({})).toBe(0);
    });

    it('should handle only transparent actions', () => {
      expect(
        calculateLogicalActions({
          transparentInputs: 5,
          transparentOutputs: 3,
        })
      ).toBe(5);
    });

    it('should handle only sapling actions', () => {
      expect(
        calculateLogicalActions({
          saplingSpends: 2,
          saplingOutputs: 4,
        })
      ).toBe(4);
    });

    it('should handle only orchard actions', () => {
      expect(
        calculateLogicalActions({
          orchardActions: 7,
        })
      ).toBe(7);
    });
  });

  describe('calculateConventionalFee', () => {
    it('should apply grace period for small transactions', () => {
      // 0 actions should still pay minimum (2 * 5000 = 10000)
      expect(calculateConventionalFee(0)).toBe(10000);
      expect(calculateConventionalFee(1)).toBe(10000);
      expect(calculateConventionalFee(2)).toBe(10000);
    });

    it('should scale fee for larger transactions', () => {
      expect(calculateConventionalFee(3)).toBe(15000);
      expect(calculateConventionalFee(5)).toBe(25000);
      expect(calculateConventionalFee(10)).toBe(50000);
    });

    it('should match ZIP317 minimum fee constant', () => {
      expect(calculateConventionalFee(0)).toBe(ZIP317.MINIMUM_FEE);
    });
  });

  describe('estimateTransactionFee', () => {
    it('should return complete fee estimate structure', () => {
      const estimate = estimateTransactionFee({
        saplingSpends: 1,
        saplingOutputs: 2,
      });

      expect(estimate).toHaveProperty('zatoshis');
      expect(estimate).toHaveProperty('zec');
      expect(estimate).toHaveProperty('logicalActions');
      expect(estimate).toHaveProperty('breakdown');
      expect(estimate.breakdown).toHaveProperty('transparent');
      expect(estimate.breakdown).toHaveProperty('sapling');
      expect(estimate.breakdown).toHaveProperty('orchard');
    });

    it('should calculate correct ZEC from zatoshis', () => {
      const estimate = estimateTransactionFee({
        orchardActions: 5,
      });

      expect(estimate.zatoshis).toBe(25000);
      expect(estimate.zec).toBe(0.00025);
    });

    it('should apply minimum fee for empty transactions', () => {
      const estimate = estimateTransactionFee({});

      expect(estimate.zatoshis).toBe(ZIP317.MINIMUM_FEE);
      expect(estimate.logicalActions).toBe(0);
    });

    it('should correctly attribute actions to each pool', () => {
      const estimate = estimateTransactionFee({
        transparentInputs: 2,
        transparentOutputs: 3,
        saplingSpends: 1,
        saplingOutputs: 2,
        orchardActions: 4,
      });

      expect(estimate.breakdown.transparent).toBe(3); // max(2, 3)
      expect(estimate.breakdown.sapling).toBe(2); // max(1, 2)
      expect(estimate.breakdown.orchard).toBe(4);
      expect(estimate.logicalActions).toBe(9); // 3 + 2 + 4
    });
  });
});

describe('ShieldedTransactionBuilder', () => {
  let builder: ShieldedTransactionBuilder;

  // Test addresses
  const validSaplingAddress =
    'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';
  const validUnifiedAddress =
    'u1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty6q8n7qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk7cyxv';
  const validTransparentAddress = 't1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU';
  const validSproutAddress =
    'zcRYvLiURno1LhXq95e8avXFcH2fKKToSLfcMoRBGCKbZ6vQJTWyHQYKZhZFVCFskNxXFXN3VVNYExfWBvnwLUpN6V2gXYZ';

  beforeEach(() => {
    builder = new ShieldedTransactionBuilder();
  });

  describe('constructor', () => {
    it('should use default values when no options provided', () => {
      const tx = builder.buildShieldedWithdrawal(validSaplingAddress, validTransparentAddress, 1n * ZAT);
      const request = builder.prepareZSendmany(tx);

      expect(request.minconf).toBe(10);
      expect(request.privacyPolicy).toBe('FullPrivacy');
    });

    it('should accept custom options', () => {
      const customBuilder = new ShieldedTransactionBuilder({
        minconf: 5,
        privacyPolicy: 'LegacyCompat',
      });

      const tx = customBuilder.buildShieldedWithdrawal(
        validSaplingAddress,
        validTransparentAddress,
        1n * ZAT
      );
      const request = customBuilder.prepareZSendmany(tx);

      expect(request.minconf).toBe(5);
      expect(request.privacyPolicy).toBe('LegacyCompat');
    });
  });

  describe('buildShieldedWithdrawal', () => {
    it('should build a valid pending transaction', () => {
      const tx = builder.buildShieldedWithdrawal(
        validSaplingAddress,
        validTransparentAddress,
        150_000_000n // 1.5 ZEC in zatoshis
      );

      expect(tx.from).toBe(validSaplingAddress);
      expect(tx.to).toBe(validTransparentAddress);
      expect(tx.amount).toBe(150_000_000n);
      expect(tx.fromType).toBe('sapling');
      expect(tx.toType).toBe('transparent');
      expect(tx.createdAt).toBeLessThanOrEqual(Date.now());
      expect(tx.memo).toBeUndefined();
    });

    it('should accept memo for shielded recipients', () => {
      const memo = '48656c6c6f'; // "Hello" in hex
      const tx = builder.buildShieldedWithdrawal(
        validSaplingAddress,
        validSaplingAddress,
        1n * ZAT,
        memo
      );

      expect(tx.memo).toBe(memo);
    });

    it('should throw for invalid source address', () => {
      expect(() => {
        builder.buildShieldedWithdrawal('invalid', validTransparentAddress, 1n * ZAT);
      }).toThrow(TransactionBuilderError);

      try {
        builder.buildShieldedWithdrawal('invalid', validTransparentAddress, 1n * ZAT);
      } catch (error) {
        expect(error).toBeInstanceOf(TransactionBuilderError);
        expect((error as TransactionBuilderError).code).toBe('INVALID_FROM_ADDRESS');
      }
    });

    it('should throw for non-shielded source address', () => {
      expect(() => {
        builder.buildShieldedWithdrawal(validTransparentAddress, validSaplingAddress, 1n * ZAT);
      }).toThrow(TransactionBuilderError);

      try {
        builder.buildShieldedWithdrawal(validTransparentAddress, validSaplingAddress, 1n * ZAT);
      } catch (error) {
        expect(error).toBeInstanceOf(TransactionBuilderError);
        expect((error as TransactionBuilderError).code).toBe('NOT_SHIELDED_SOURCE');
      }
    });

    it('should throw for invalid destination address', () => {
      expect(() => {
        builder.buildShieldedWithdrawal(validSaplingAddress, 'invalid', 1n * ZAT);
      }).toThrow(TransactionBuilderError);

      try {
        builder.buildShieldedWithdrawal(validSaplingAddress, 'invalid', 1n * ZAT);
      } catch (error) {
        expect(error).toBeInstanceOf(TransactionBuilderError);
        expect((error as TransactionBuilderError).code).toBe('INVALID_TO_ADDRESS');
      }
    });

    it('should throw for invalid amount', () => {
      expect(() => {
        builder.buildShieldedWithdrawal(validSaplingAddress, validTransparentAddress, 0n);
      }).toThrow(TransactionBuilderError);

      expect(() => {
        builder.buildShieldedWithdrawal(validSaplingAddress, validTransparentAddress, -1n);
      }).toThrow(TransactionBuilderError);
    });

    it('should throw for memo on transparent recipient', () => {
      expect(() => {
        builder.buildShieldedWithdrawal(
          validSaplingAddress,
          validTransparentAddress,
          1n * ZAT,
          '48656c6c6f'
        );
      }).toThrow(TransactionBuilderError);

      try {
        builder.buildShieldedWithdrawal(
          validSaplingAddress,
          validTransparentAddress,
          1n * ZAT,
          '48656c6c6f'
        );
      } catch (error) {
        expect((error as TransactionBuilderError).code).toBe('MEMO_NOT_ALLOWED');
      }
    });

    it('should throw for non-hex memo', () => {
      expect(() => {
        builder.buildShieldedWithdrawal(
          validSaplingAddress,
          validSaplingAddress,
          1n * ZAT,
          'not-hex!'
        );
      }).toThrow(TransactionBuilderError);

      try {
        builder.buildShieldedWithdrawal(validSaplingAddress, validSaplingAddress, 1n * ZAT, 'not-hex!');
      } catch (error) {
        expect((error as TransactionBuilderError).code).toBe('INVALID_MEMO_FORMAT');
      }
    });

    it('should throw for memo exceeding max length', () => {
      const longMemo = 'a'.repeat(1025); // 512.5 bytes in hex

      expect(() => {
        builder.buildShieldedWithdrawal(validSaplingAddress, validSaplingAddress, 1n * ZAT, longMemo);
      }).toThrow(TransactionBuilderError);

      try {
        builder.buildShieldedWithdrawal(validSaplingAddress, validSaplingAddress, 1n * ZAT, longMemo);
      } catch (error) {
        expect((error as TransactionBuilderError).code).toBe('MEMO_TOO_LONG');
      }
    });

    it('should work with unified addresses', () => {
      const tx = builder.buildShieldedWithdrawal(
        validUnifiedAddress,
        validTransparentAddress,
        250_000_000n // 2.5 ZEC in zatoshis
      );

      expect(tx.fromType).toBe('unified');
      expect(tx.toType).toBe('transparent');
    });

    it('should work with Sprout source addresses', () => {
      const tx = builder.buildShieldedWithdrawal(
        validSproutAddress,
        validTransparentAddress,
        50_000_000n // 0.5 ZEC in zatoshis
      );

      expect(tx.fromType).toBe('sprout');
    });
  });

  describe('estimateFee', () => {
    it('should estimate fee for Sapling to transparent', async () => {
      const tx = builder.buildShieldedWithdrawal(
        validSaplingAddress,
        validTransparentAddress,
        1n * ZAT
      );

      const fee = await builder.estimateFee(tx);

      expect(fee).toBeGreaterThan(0n);
      expect(fee).toBeLessThan(1n * ZAT); // Fee should be much less than 1 ZEC
    });

    it('should estimate fee for Unified to Sapling', async () => {
      const tx = builder.buildShieldedWithdrawal(validUnifiedAddress, validSaplingAddress, 1n * ZAT);

      const fee = await builder.estimateFee(tx);

      expect(fee).toBeGreaterThan(0n);
    });

    it('should include change output in estimation', async () => {
      const txWithChange = builder.buildShieldedWithdrawal(
        validSaplingAddress,
        validTransparentAddress,
        50_000_000n // 0.5 ZEC - Not spending full balance
      );

      const feeWithChange = await builder.estimateFee(txWithChange);

      // Fee should account for change output
      expect(feeWithChange).toBeGreaterThanOrEqual(BigInt(ZIP317.MINIMUM_FEE));
    });

    it('should handle Sprout transactions with higher fees', async () => {
      const tx = builder.buildShieldedWithdrawal(
        validSproutAddress,
        validTransparentAddress,
        1n * ZAT
      );

      const fee = await builder.estimateFee(tx);

      // Sprout uses JoinSplits which count as more actions
      expect(fee).toBeGreaterThanOrEqual(BigInt(ZIP317.MINIMUM_FEE));
    });
  });

  describe('prepareZSendmany', () => {
    it('should prepare a valid z_sendmany request', () => {
      const tx = builder.buildShieldedWithdrawal(
        validSaplingAddress,
        validTransparentAddress,
        150_000_000n // 1.5 ZEC in zatoshis
      );

      const request = builder.prepareZSendmany(tx);

      expect(request.fromaddress).toBe(validSaplingAddress);
      expect(request.amounts).toHaveLength(1);
      expect(request.amounts[0].address).toBe(validTransparentAddress);
      expect(request.amounts[0].amount).toBe('1.50000000'); // ZEC string
      expect(request.amounts[0].memo).toBeUndefined();
      expect(request.minconf).toBe(10);
      expect(request.fee).toBeNull();
      expect(request.privacyPolicy).toBe('FullPrivacy');
    });

    it('should include memo for shielded recipients', () => {
      const memo = '48656c6c6f';
      const tx = builder.buildShieldedWithdrawal(
        validSaplingAddress,
        validSaplingAddress,
        1n * ZAT,
        memo
      );

      const request = builder.prepareZSendmany(tx);

      expect(request.amounts[0].memo).toBe(memo);
    });

    it('should accept custom options', () => {
      const tx = builder.buildShieldedWithdrawal(
        validSaplingAddress,
        validTransparentAddress,
        1n * ZAT
      );

      const request = builder.prepareZSendmany(tx, {
        minconf: 1,
        feeZatoshis: 10000n, // 0.0001 ZEC in zatoshis
        privacyPolicy: 'AllowRevealedAmounts',
      });

      expect(request.minconf).toBe(1);
      expect(request.fee).toBe('0.00010000'); // ZEC string
      expect(request.privacyPolicy).toBe('AllowRevealedAmounts');
    });

    it('should use transaction fee if set', () => {
      const tx = builder.buildShieldedWithdrawal(
        validSaplingAddress,
        validTransparentAddress,
        1n * ZAT
      );
      tx.fee = 15000n; // 0.00015 ZEC in zatoshis

      const request = builder.prepareZSendmany(tx);

      expect(request.fee).toBe('0.00015000'); // ZEC string
    });
  });

  describe('validateTransaction', () => {
    it('should validate correct transaction parameters', () => {
      const result = builder.validateTransaction(
        validSaplingAddress,
        validTransparentAddress,
        1n * ZAT
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid source address', () => {
      const result = builder.validateTransaction('invalid', validTransparentAddress, 1n * ZAT);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid source address');
    });

    it('should detect non-shielded source address', () => {
      const result = builder.validateTransaction(
        validTransparentAddress,
        validSaplingAddress,
        1n * ZAT
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Source address must be shielded');
    });

    it('should detect invalid destination address', () => {
      const result = builder.validateTransaction(validSaplingAddress, 'invalid', 1n * ZAT);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid destination address');
    });

    it('should detect invalid amount', () => {
      const result = builder.validateTransaction(validSaplingAddress, validTransparentAddress, 0n);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Amount must be a positive bigint (zatoshis)');
    });

    it('should collect multiple errors', () => {
      const result = builder.validateTransaction('invalid', 'also-invalid', -1n);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('TransactionBuilderError', () => {
  it('should have correct name and properties', () => {
    const error = new TransactionBuilderError('Test error', 'TEST_CODE');

    expect(error.name).toBe('TransactionBuilderError');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TransactionBuilderError);
  });
});

describe('ZIP317 Constants', () => {
  it('should have correct constant values', () => {
    expect(ZIP317.MARGINAL_FEE).toBe(5000);
    expect(ZIP317.GRACE_ACTIONS).toBe(2);
    expect(ZIP317.P2PKH_INPUT_SIZE).toBe(150);
    expect(ZIP317.P2PKH_OUTPUT_SIZE).toBe(34);
    expect(ZIP317.MINIMUM_FEE).toBe(10000);
    expect(ZIP317.ZATOSHIS_PER_ZEC).toBe(100_000_000);
  });

  it('should have consistent minimum fee calculation', () => {
    expect(ZIP317.MINIMUM_FEE).toBe(ZIP317.MARGINAL_FEE * ZIP317.GRACE_ACTIONS);
  });
});

describe('Additional fee estimation edge cases', () => {
  let builder: ShieldedTransactionBuilder;

  const validSaplingAddress =
    'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';
  const validUnifiedAddress =
    'u1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty6q8n7qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk7cyxv';
  const validSproutAddress =
    'zcRYvLiURno1LhXq95e8avXFcH2fKKToSLfcMoRBGCKbZ6vQJTWyHQYKZhZFVCFskNxXFXN3VVNYExfWBvnwLUpN6V2gXYZ';

  beforeEach(() => {
    builder = new ShieldedTransactionBuilder();
  });

  it('should estimate fee for Unified to Unified (Orchard to Orchard)', async () => {
    const tx = builder.buildShieldedWithdrawal(validUnifiedAddress, validUnifiedAddress, 1n * ZAT);
    const fee = await builder.estimateFee(tx);
    expect(fee).toBeGreaterThan(0n);
  });

  it('should estimate fee for Sapling to Sapling', async () => {
    const tx = builder.buildShieldedWithdrawal(validSaplingAddress, validSaplingAddress, 1n * ZAT);
    const fee = await builder.estimateFee(tx);
    expect(fee).toBeGreaterThan(0n);
  });

  it('should estimate fee for Sprout to Sprout', async () => {
    const tx = builder.buildShieldedWithdrawal(validSproutAddress, validSproutAddress, 1n * ZAT);
    const fee = await builder.estimateFee(tx);
    expect(fee).toBeGreaterThan(0n);
  });

  it('should estimate fee for Unified to Sapling', async () => {
    const tx = builder.buildShieldedWithdrawal(validUnifiedAddress, validSaplingAddress, 1n * ZAT);
    const fee = await builder.estimateFee(tx);
    expect(fee).toBeGreaterThan(0n);
  });

  it('should estimate fee for Sprout to Unified', async () => {
    const tx = builder.buildShieldedWithdrawal(validSproutAddress, validUnifiedAddress, 1n * ZAT);
    const fee = await builder.estimateFee(tx);
    expect(fee).toBeGreaterThan(0n);
  });
});
