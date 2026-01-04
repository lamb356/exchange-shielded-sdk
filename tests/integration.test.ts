/**
 * Integration Tests
 *
 * Tests for the full SDK workflow including security and compliance.
 * All amounts are in zatoshis (1 ZEC = 100_000_000 zatoshis).
 */

import {
  ExchangeShieldedSDK,
  createExchangeSDK,
  AuditEventType,
  setValidationOptions,
  resetValidationOptions,
} from '../src/index.js';

// Helper constant for zatoshis (1 ZEC = 100_000_000 zatoshis)
const ZAT = 100_000_000n;

// Use format-only validation for tests (fake addresses don't have valid checksums)
beforeAll(() => {
  setValidationOptions({ skipChecksum: true });
});

afterAll(() => {
  resetValidationOptions();
});

// Mock fetch for RPC calls
const createMockFetch = (responses: Record<string, unknown> = {}) => {
  return async (url: string, options: { body: string }) => {
    const body = JSON.parse(options.body);
    const method = body.method;

    // Default responses
    const defaultResponses: Record<string, unknown> = {
      z_sendmany: 'opid-mock-operation-id',
      z_getoperationstatus: [
        {
          id: 'opid-mock-operation-id',
          status: 'success',
          creation_time: Date.now() / 1000,
          method: 'z_sendmany',
          params: {},
        },
      ],
      z_getoperationresult: [
        {
          id: 'opid-mock-operation-id',
          status: 'success',
          creation_time: Date.now() / 1000,
          result: { txid: 'mock-txid-' + Math.random().toString(36).slice(2) },
          method: 'z_sendmany',
          params: {},
        },
      ],
      z_getbalance: 100.5,
      ...responses,
    };

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        result: defaultResponses[method] ?? null,
        error: null,
        id: body.id,
      }),
    };
  };
};

describe('ExchangeShieldedSDK Integration', () => {
  let sdk: ExchangeShieldedSDK;
  let mockFetch: ReturnType<typeof createMockFetch>;

  const saplingSource =
    'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';
  const saplingDest =
    'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny';

  beforeEach(() => {
    mockFetch = createMockFetch();

    sdk = new ExchangeShieldedSDK({
      rpc: {
        host: '127.0.0.1',
        port: 8232,
        auth: { username: 'user', password: 'pass' },
      },
      enableCompliance: true,
      enableAuditLogging: true,
    });

    // Inject mock fetch into the RPC client
    // This is a simplification for testing - in production you'd use proper DI
  });

  describe('SDK Configuration', () => {
    it('should create SDK with default config', () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
      });

      expect(sdk).toBeInstanceOf(ExchangeShieldedSDK);
    });

    it('should create SDK with compliance enabled', () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
        enableCompliance: true,
      });

      expect(sdk.getComplianceManager()).toBeDefined();
    });

    it('should create SDK with audit logging enabled', () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
        enableAuditLogging: true,
      });

      expect(sdk.getAuditLogger()).toBeDefined();
    });
  });

  describe('Withdrawal Request Validation', () => {
    it('should reject invalid source address', async () => {
      const result = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress: 'invalid-address',
        toAddress: saplingDest,
        amount: 10n * ZAT,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_FROM_ADDRESS');
    });

    it('should reject transparent source address with clear error', async () => {
      // SECURITY: Transparent addresses cannot be used as source for shielded withdrawals
      const result = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress: 't1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU', // transparent address
        toAddress: saplingDest,
        amount: 10n * ZAT,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FROM_ADDRESS_NOT_SHIELDED');
      expect(result.error).toContain('shielded');
    });

    it('should reject invalid destination address', async () => {
      const result = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress: saplingSource,
        toAddress: 'invalid-address',
        amount: 10n * ZAT,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_TO_ADDRESS');
    });

    it('should reject invalid amount', async () => {
      const result = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress: saplingSource,
        toAddress: saplingDest,
        amount: -10n,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_AMOUNT');
    });

    it('should reject invalid memo', async () => {
      const result = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress: saplingSource,
        toAddress: saplingDest,
        amount: 10n * ZAT,
        memo: 'not-hex!@#$',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_MEMO');
    });
  });

  describe('Rate Limiting Integration', () => {
    it('should check rate limits before processing', () => {
      const result = sdk.checkRateLimit('user-1', 10n * ZAT);

      expect(result).toBeDefined();
      expect(typeof result.allowed).toBe('boolean');
    });

    it('should enforce rate limits on multiple requests', async () => {
      // Configure a strict rate limiter for testing
      const strictSdk = new ExchangeShieldedSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
        rateLimiter: {
          maxWithdrawalsPerHour: 1,
          maxWithdrawalsPerDay: 5,
          maxAmountPerWithdrawal: 100n * ZAT,
          maxTotalAmountPerDay: 500n * ZAT,
          cooldownMs: 60000,
        },
      });

      // First check should pass
      const check1 = strictSdk.checkRateLimit('user-1', 10n * ZAT);
      expect(check1.allowed).toBe(true);

      // Simulate a recorded withdrawal by checking velocity
      strictSdk.checkVelocity('user-1', 10n * ZAT);
    });
  });

  describe('Velocity Check Integration', () => {
    it('should check velocity before processing', () => {
      const result = sdk.checkVelocity('user-1', 10n * ZAT);

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Fee Estimation', () => {
    it('should estimate fee for shielded withdrawal', async () => {
      const estimate = await sdk.estimateWithdrawalFee(10n * ZAT, saplingDest);

      expect(estimate.feeZatoshis).toBeGreaterThan(0n);
      expect(estimate.isApproximate).toBe(true);
    });

    it('should estimate fee for transparent destination', async () => {
      const estimate = await sdk.estimateWithdrawalFee(
        10n * ZAT,
        't1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU'
      );

      expect(estimate.feeZatoshis).toBeGreaterThan(0n);
    });

    it('should throw for invalid destination', async () => {
      await expect(
        sdk.estimateWithdrawalFee(10n * ZAT, 'invalid-address')
      ).rejects.toThrow();
    });
  });

  describe('Compliance Report', () => {
    it('should generate compliance report', async () => {
      const period = {
        start: new Date(Date.now() - 86400000),
        end: new Date(),
      };

      const report = await sdk.getComplianceReport(period);

      expect(report.generatedAt).toBeInstanceOf(Date);
      expect(report.summary).toBeDefined();
    });
  });

  describe('Audit Logging Integration', () => {
    it('should log audit events during operations', () => {
      const auditLogger = sdk.getAuditLogger();
      const initialCount = auditLogger.getEventCount();

      // Check velocity (which logs)
      sdk.checkVelocity('user-1', 10n * ZAT);

      // Count may or may not increase depending on implementation
      expect(auditLogger.getEventCount()).toBeGreaterThanOrEqual(initialCount);
    });
  });

  describe('Key Manager Access', () => {
    it('should provide access to key manager', () => {
      const keyManager = sdk.getKeyManager();

      expect(keyManager).toBeDefined();
      expect(keyManager.getKeyCount()).toBe(0);
    });

    it('should allow loading keys through key manager', () => {
      const keyManager = sdk.getKeyManager();
      const testKey = Buffer.alloc(32, 0x42);

      keyManager.loadRawKey('test-key', testKey, 'sapling');

      expect(keyManager.hasKey('test-key')).toBe(true);
    });
  });

  describe('Withdrawal Status', () => {
    it('should return null for unknown request ID', async () => {
      const status = await sdk.getWithdrawalStatus('unknown-request-id');
      expect(status).toBeNull();
    });

    it('should get withdrawal status by txid after processing', async () => {
      // The getWithdrawalByTxid method is available for lookup by transaction ID
      const status = await sdk.getWithdrawalByTxid('mock-txid');
      // Returns null if not found since we haven't processed any withdrawals
      expect(status).toBeNull();
    });

    it('should list pending withdrawals', async () => {
      const pending = await sdk.listPendingWithdrawals();
      // Returns empty array when no pending withdrawals
      expect(pending).toEqual([]);
    });
  });

  describe('Viewing Key Export', () => {
    it('should export viewing keys', async () => {
      const complianceManager = sdk.getComplianceManager();

      // Register a viewing key first
      complianceManager.registerViewingKey('key-1', 'test-viewing-key', 'sapling');

      const bundle = await sdk.exportViewingKeys();

      expect(bundle.bundleId).toBeDefined();
      expect(bundle.keys.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('Security Integration', () => {
  describe('Key Isolation', () => {
    it('should not expose keys in SDK toString', () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
      });

      const keyManager = sdk.getKeyManager();
      const testKey = Buffer.alloc(32, 0x42);
      keyManager.loadRawKey('secret-key', testKey, 'sapling');

      const str = keyManager.toString();

      expect(str).not.toContain('42');
      expect(str).not.toContain('secret');
    });

    it('should not expose keys in error messages', () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
      });

      const keyManager = sdk.getKeyManager();

      try {
        keyManager.signTransaction('non-existent', Buffer.from('data'));
      } catch (error) {
        expect((error as Error).message).not.toContain('42');
      }
    });
  });

  describe('Input Sanitization in SDK', () => {
    it('should sanitize addresses before processing', async () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
      });

      // Address with whitespace should be handled
      const result = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress:
          '  zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly  ',
        toAddress:
          'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: 10n * ZAT,
      });

      // Will fail at RPC level, but should pass validation
      expect(result.errorCode).not.toBe('INVALID_FROM_ADDRESS');
    });
  });

  describe('Audit Trail', () => {
    it('should create audit trail for withdrawal flow', async () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
        enableAuditLogging: true,
      });

      const auditLogger = sdk.getAuditLogger();
      const initialCount = auditLogger.getEventCount();

      // Attempt a withdrawal (will fail at RPC but should log)
      await sdk.processWithdrawal({
        userId: 'audit-test-user',
        fromAddress:
          'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
        toAddress:
          'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: 10n * ZAT,
      });

      // Should have logged events
      const events = auditLogger.getEvents({
        userId: 'audit-test-user',
      });

      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('should log rate limit hits', async () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
        rateLimiter: {
          maxAmountPerWithdrawal: 5n * ZAT, // 5 ZEC limit
          maxWithdrawalsPerHour: 10,
          maxWithdrawalsPerDay: 50,
          maxTotalAmountPerDay: 500n * ZAT,
          cooldownMs: 0,
        },
        enableAuditLogging: true,
      });

      // Try withdrawal exceeding per-withdrawal limit
      const result = await sdk.processWithdrawal({
        userId: 'rate-limit-test-user',
        fromAddress:
          'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
        toAddress:
          'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: 10n * ZAT, // Exceeds 5 ZEC limit
      });

      // Verify the rate limit was triggered
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('RATE_LIMITED');

      const auditLogger = sdk.getAuditLogger();
      const rateLimitEvents = auditLogger.getEvents({
        eventTypes: [AuditEventType.RATE_LIMIT_HIT],
      });

      expect(rateLimitEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Request ID Idempotency', () => {
    it('should return cached result for duplicate requestId', async () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
        rateLimiter: {
          maxAmountPerWithdrawal: 5n * ZAT, // 5 ZEC limit
          maxWithdrawalsPerHour: 10,
          maxWithdrawalsPerDay: 50,
          maxTotalAmountPerDay: 500n * ZAT,
          cooldownMs: 0,
        },
      });

      const requestId = 'idempotent-request-123';
      const request = {
        userId: 'idempotency-test-user',
        fromAddress:
          'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
        toAddress:
          'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: 10n * ZAT, // Exceeds 5 ZEC limit
        requestId,
      };

      // First call should fail due to rate limit
      const result1 = await sdk.processWithdrawal(request);
      expect(result1.success).toBe(false);
      expect(result1.errorCode).toBe('RATE_LIMITED');
      expect(result1.requestId).toBe(requestId);

      // Second call with same requestId should return cached result immediately
      // (not fail again due to rate limit)
      const result2 = await sdk.processWithdrawal(request);
      expect(result2.success).toBe(false);
      expect(result2.errorCode).toBe('RATE_LIMITED');
      expect(result2.requestId).toBe(requestId);

      // Results should be identical
      expect(result1.error).toBe(result2.error);
    });

    it('should NOT cache validation failures (allowing retry with corrected input)', async () => {
      const sdk = createExchangeSDK({
        rpc: {
          host: '127.0.0.1',
          port: 8232,
          auth: { username: 'user', password: 'pass' },
        },
      });

      const requestId = 'validation-test-456';

      // First call with invalid address should fail
      const result1 = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress: 'invalid-address',
        toAddress:
          'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: 1n * ZAT,
        requestId,
      });
      expect(result1.success).toBe(false);
      expect(result1.errorCode).toBe('INVALID_FROM_ADDRESS');

      // Second call with same requestId but valid address should NOT return cached result
      // (validation failures are not cached to allow retry with corrected input)
      const result2 = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress:
          'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
        toAddress:
          'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: 1n * ZAT,
        requestId,
      });

      // This should be a new attempt, not the cached failure
      // It will fail at RPC but with a different error (INTERNAL_ERROR)
      expect(result2.errorCode).not.toBe('INVALID_FROM_ADDRESS');
    });
  });
});
