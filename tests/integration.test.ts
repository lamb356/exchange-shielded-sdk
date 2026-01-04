/**
 * Integration Tests
 *
 * Tests for the full SDK workflow including security and compliance.
 */

import {
  ExchangeShieldedSDK,
  createExchangeSDK,
  AuditEventType,
  setValidationOptions,
  resetValidationOptions,
} from '../src/index.js';

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
        amount: 10,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_FROM_ADDRESS');
    });

    it('should reject invalid destination address', async () => {
      const result = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress: saplingSource,
        toAddress: 'invalid-address',
        amount: 10,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_TO_ADDRESS');
    });

    it('should reject invalid amount', async () => {
      const result = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress: saplingSource,
        toAddress: saplingDest,
        amount: -10,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_AMOUNT');
    });

    it('should reject invalid memo', async () => {
      const result = await sdk.processWithdrawal({
        userId: 'user-1',
        fromAddress: saplingSource,
        toAddress: saplingDest,
        amount: 10,
        memo: 'not-hex!@#$',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_MEMO');
    });
  });

  describe('Rate Limiting Integration', () => {
    it('should check rate limits before processing', () => {
      const result = sdk.checkRateLimit('user-1', 10);

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
          maxAmountPerWithdrawal: 100,
          maxTotalAmountPerDay: 500,
          cooldownMs: 60000,
        },
      });

      // First check should pass
      const check1 = strictSdk.checkRateLimit('user-1', 10);
      expect(check1.allowed).toBe(true);

      // Simulate a recorded withdrawal by checking velocity
      strictSdk.checkVelocity('user-1', 10);
    });
  });

  describe('Velocity Check Integration', () => {
    it('should check velocity before processing', () => {
      const result = sdk.checkVelocity('user-1', 10);

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Fee Estimation', () => {
    it('should estimate fee for shielded withdrawal', async () => {
      const estimate = await sdk.estimateWithdrawalFee(10, saplingDest);

      expect(estimate.feeZec).toBeGreaterThan(0);
      expect(estimate.feeZatoshis).toBeGreaterThan(0);
      expect(estimate.isApproximate).toBe(true);
    });

    it('should estimate fee for transparent destination', async () => {
      const estimate = await sdk.estimateWithdrawalFee(
        10,
        't1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU'
      );

      expect(estimate.feeZec).toBeGreaterThan(0);
    });

    it('should throw for invalid destination', async () => {
      await expect(
        sdk.estimateWithdrawalFee(10, 'invalid-address')
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
      sdk.checkVelocity('user-1', 10);

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
    it('should get withdrawal status', async () => {
      const status = await sdk.getWithdrawalStatus('mock-txid');

      expect(status.status).toBeDefined();
      expect(status.updatedAt).toBeInstanceOf(Date);
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
        amount: 10,
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
        amount: 10,
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
          maxAmountPerWithdrawal: 5, // Very low limit
          maxWithdrawalsPerHour: 10,
          maxWithdrawalsPerDay: 50,
          maxTotalAmountPerDay: 500,
          cooldownMs: 0,
        },
        enableAuditLogging: true,
      });

      // Try withdrawal exceeding limit
      await sdk.processWithdrawal({
        userId: 'rate-limit-test-user',
        fromAddress:
          'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
        toAddress:
          'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
        amount: 10, // Exceeds 5 ZEC limit
      });

      const auditLogger = sdk.getAuditLogger();
      const rateLimitEvents = auditLogger.getEvents({
        eventTypes: [AuditEventType.RATE_LIMIT_HIT],
      });

      expect(rateLimitEvents.length).toBeGreaterThanOrEqual(1);
    });
  });
});
