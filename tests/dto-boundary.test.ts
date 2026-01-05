import {
  WithdrawalRequestDTO,
  WithdrawalResultDTO,
  WithdrawalStatusDTO,
  toWithdrawalResultDTO,
  fromWithdrawalRequestDTO,
  toWithdrawalStatusDTO,
} from '../src/types/dto.js';
import { zatoshi } from '../src/types/money.js';
import {
  parseZatoshiInput,
  validateAddressInput,
  validateUserIdInput,
  IngestValidationError,
} from '../src/validation/ingest.js';
import {
  ExchangeShieldedSDK,
  createExchangeSDK,
  setValidationOptions,
  resetValidationOptions,
} from '../src/index.js';

describe('DTO Boundary', () => {
  describe('toWithdrawalResultDTO', () => {
    it('should convert internal result to DTO', () => {
      const internal = {
        success: true,
        requestId: 'req-123',
        transactionId: 'txid-abc',
        amount: zatoshi(150_000_000n),
        fee: zatoshi(10_000n),
        completedAt: new Date('2024-01-15T10:30:00Z'),
      };

      const dto = toWithdrawalResultDTO(internal);

      expect(dto.success).toBe(true);
      expect(dto.amount).toBe('150000000');
      expect(dto.fee).toBe('10000');
      expect(dto.completedAt).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should handle undefined optional fields', () => {
      const internal = {
        success: false,
        error: 'Rate limited',
        errorCode: 'RATE_LIMITED',
      };

      const dto = toWithdrawalResultDTO(internal);

      expect(dto.success).toBe(false);
      expect(dto.amount).toBeUndefined();
      expect(dto.fee).toBeUndefined();
    });
  });

  describe('fromWithdrawalRequestDTO', () => {
    it('should convert DTO to internal request', () => {
      const dto: WithdrawalRequestDTO = {
        userId: 'user-123',
        fromAddress: 'zs1source...',
        toAddress: 'zs1dest...',
        amount: '150000000',
      };

      const internal = fromWithdrawalRequestDTO(dto);

      expect(internal.userId).toBe('user-123');
      expect(internal.amount).toBe(150_000_000n);
    });

    it('should reject non-numeric amount', () => {
      const dto: WithdrawalRequestDTO = {
        userId: 'user-123',
        fromAddress: 'zs1source...',
        toAddress: 'zs1dest...',
        amount: '1.5', // Not an integer
      };

      expect(() => fromWithdrawalRequestDTO(dto)).toThrow(/integer string/);
    });

    it('should reject negative amount', () => {
      const dto: WithdrawalRequestDTO = {
        userId: 'user-123',
        fromAddress: 'zs1source...',
        toAddress: 'zs1dest...',
        amount: '-100',
      };

      expect(() => fromWithdrawalRequestDTO(dto)).toThrow(/non-negative/);
    });
  });
});

describe('Input Validation', () => {
  describe('parseZatoshiInput', () => {
    it('should parse valid string', () => {
      expect(parseZatoshiInput('100000000')).toBe(100_000_000n);
    });

    it('should parse valid bigint', () => {
      expect(parseZatoshiInput(100_000_000n)).toBe(100_000_000n);
    });

    it('should parse valid integer number', () => {
      expect(parseZatoshiInput(100000000)).toBe(100_000_000n);
    });

    it('should reject null', () => {
      expect(() => parseZatoshiInput(null)).toThrow(IngestValidationError);
    });

    it('should reject undefined', () => {
      expect(() => parseZatoshiInput(undefined)).toThrow(IngestValidationError);
    });

    it('should reject non-numeric string', () => {
      expect(() => parseZatoshiInput('1.5')).toThrow(/non-negative integer/);
    });

    it('should reject negative string', () => {
      expect(() => parseZatoshiInput('-100')).toThrow(/non-negative/);
    });

    it('should reject Infinity', () => {
      expect(() => parseZatoshiInput(Infinity)).toThrow(/finite/);
    });

    it('should reject NaN', () => {
      expect(() => parseZatoshiInput(NaN)).toThrow(/finite/);
    });

    it('should reject floating-point number', () => {
      expect(() => parseZatoshiInput(1.5)).toThrow(/integer/);
    });

    it('should reject negative bigint', () => {
      expect(() => parseZatoshiInput(-100n)).toThrow(/negative/);
    });

    it('should reject amount exceeding max supply', () => {
      const tooMuch = BigInt('3000000000000000'); // 30 million ZEC
      expect(() => parseZatoshiInput(tooMuch)).toThrow(/max/i);
    });

    it('should include field name in error', () => {
      try {
        parseZatoshiInput(null, 'withdrawalAmount');
        fail('Should have thrown');
      } catch (e) {
        expect((e as IngestValidationError).field).toBe('withdrawalAmount');
      }
    });
  });

  describe('validateAddressInput', () => {
    it('should accept valid address string', () => {
      expect(validateAddressInput('zs1abc...')).toBe('zs1abc...');
    });

    it('should trim whitespace', () => {
      expect(validateAddressInput('  zs1abc...  ')).toBe('zs1abc...');
    });

    it('should reject empty string', () => {
      expect(() => validateAddressInput('')).toThrow(/empty/);
    });

    it('should reject non-string', () => {
      expect(() => validateAddressInput(123)).toThrow(/string/);
    });

    it('should reject too-long address', () => {
      const longAddr = 'z'.repeat(600);
      expect(() => validateAddressInput(longAddr)).toThrow(/too long/);
    });
  });

  describe('validateUserIdInput', () => {
    it('should accept valid user ID', () => {
      expect(validateUserIdInput('user-123')).toBe('user-123');
    });

    it('should accept alphanumeric with dots', () => {
      expect(validateUserIdInput('user.name_123-abc')).toBe('user.name_123-abc');
    });

    it('should reject empty', () => {
      expect(() => validateUserIdInput('')).toThrow(/empty/);
    });

    it('should reject special characters', () => {
      expect(() => validateUserIdInput('user@123')).toThrow(/invalid characters/);
    });
  });
});

describe('DTO Round-Trip', () => {
  it('should preserve data through DTO conversion', () => {
    const originalDTO: WithdrawalRequestDTO = {
      userId: 'user-123',
      fromAddress: 'zs1from...',
      toAddress: 'zs1to...',
      amount: '150000000',
      memo: 'test',
      requestId: 'req-abc',
    };

    // Convert to internal
    const internal = fromWithdrawalRequestDTO(originalDTO);
    expect(internal.amount).toBe(150_000_000n);

    // Simulate processing and result
    const result = {
      success: true,
      requestId: internal.requestId,
      amount: internal.amount,
      fee: zatoshi(10_000n),
      completedAt: new Date(),
    };

    // Convert back to DTO
    const resultDTO = toWithdrawalResultDTO(result);
    expect(resultDTO.amount).toBe('150000000');
    expect(resultDTO.fee).toBe('10000');
  });
});

describe('SDK DTO Methods', () => {
  let sdk: ExchangeShieldedSDK;

  beforeAll(() => {
    setValidationOptions({ skipChecksum: true });
  });

  afterAll(() => {
    resetValidationOptions();
  });

  beforeEach(() => {
    sdk = createExchangeSDK({
      rpc: {
        host: '127.0.0.1',
        port: 8232,
        auth: { username: 'test', password: 'test' },
      },
    });
  });

  describe('processWithdrawalDTO', () => {
    it('should accept DTO and return DTO', async () => {
      const requestDTO: WithdrawalRequestDTO = {
        userId: 'user-123',
        fromAddress: 'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
        toAddress: 'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: '150000000',
      };

      // Will fail at RPC level, but should pass DTO boundary checks
      const resultDTO = await sdk.processWithdrawalDTO(requestDTO);

      // Verify result is JSON-serializable (no bigint)
      expect(() => JSON.stringify(resultDTO)).not.toThrow();
      expect(typeof resultDTO.success).toBe('boolean');
      expect(resultDTO.requestId).toBeDefined();
    });

    it('should reject invalid amount string', async () => {
      const badDTO: WithdrawalRequestDTO = {
        userId: 'user-123',
        fromAddress: 'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
        toAddress: 'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: '1.5', // Not an integer
      };

      await expect(sdk.processWithdrawalDTO(badDTO)).rejects.toThrow(/integer/);
    });

    it('should reject negative amount', async () => {
      const badDTO: WithdrawalRequestDTO = {
        userId: 'user-123',
        fromAddress: 'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
        toAddress: 'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: '-100',
      };

      await expect(sdk.processWithdrawalDTO(badDTO)).rejects.toThrow(/non-negative/);
    });
  });

  describe('DTO serialization safety', () => {
    it('should never expose bigint in DTO response', async () => {
      const requestDTO: WithdrawalRequestDTO = {
        userId: 'user-123',
        fromAddress: 'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
        toAddress: 'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: '150000000',
      };

      const resultDTO = await sdk.processWithdrawalDTO(requestDTO);

      // JSON.stringify throws on bigint - this verifies no bigint in DTO
      const json = JSON.stringify(resultDTO);
      expect(json).toBeDefined();

      // Verify it can be parsed back
      const parsed = JSON.parse(json);
      expect(parsed.success).toBe(resultDTO.success);
    });
  });

  describe('status DTO methods', () => {
    it('getWithdrawalStatusDTO returns null for unknown request', async () => {
      const status = await sdk.getWithdrawalStatusDTO('nonexistent-request');
      expect(status).toBeNull();
    });

    it('listPendingWithdrawalsDTO returns empty array initially', async () => {
      const pending = await sdk.listPendingWithdrawalsDTO();
      expect(Array.isArray(pending)).toBe(true);
      expect(pending.length).toBe(0);
    });

    it('getWithdrawalByTxidDTO returns null for unknown txid', async () => {
      const status = await sdk.getWithdrawalByTxidDTO('nonexistent-txid');
      expect(status).toBeNull();
    });

    it('refreshWithdrawalStatusDTO returns null for unknown request', async () => {
      const status = await sdk.refreshWithdrawalStatusDTO('nonexistent-request');
      expect(status).toBeNull();
    });
  });
});
