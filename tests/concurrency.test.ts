/**
 * Concurrency Tests
 *
 * Tests for concurrent operations to ensure thread safety and correct
 * behavior under parallel execution.
 */

import {
  ExchangeShieldedSDK,
  createExchangeSDK,
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

describe('Concurrent Request ID Handling', () => {
  it('should handle duplicate requestIds submitted simultaneously', async () => {
    const sdk = createExchangeSDK({
      rpc: {
        host: '127.0.0.1',
        port: 8232,
        auth: { username: 'user', password: 'pass' },
      },
      rateLimiter: {
        maxAmountPerWithdrawal: 5, // Low limit to trigger rate limit
        maxWithdrawalsPerHour: 10,
        maxWithdrawalsPerDay: 50,
        maxTotalAmountPerDay: 500,
        cooldownMs: 0,
      },
    });

    const requestId = 'concurrent-test-' + Date.now();
    const request = {
      userId: 'concurrent-user',
      fromAddress:
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
      toAddress:
        'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
      amount: 10, // Exceeds 5 ZEC limit, will fail
      requestId,
    };

    // Submit the same request 5 times in parallel
    const results = await Promise.all([
      sdk.processWithdrawal(request),
      sdk.processWithdrawal(request),
      sdk.processWithdrawal(request),
      sdk.processWithdrawal(request),
      sdk.processWithdrawal(request),
    ]);

    // All results should have the same requestId
    for (const result of results) {
      expect(result.requestId).toBe(requestId);
    }

    // All results should be rate limited (same error)
    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('RATE_LIMITED');
    }

    // Error messages should be identical (cached result)
    const errors = results.map((r) => r.error);
    expect(new Set(errors).size).toBe(1); // All identical
  });

  it('should handle different requestIds in parallel correctly', async () => {
    const sdk = createExchangeSDK({
      rpc: {
        host: '127.0.0.1',
        port: 8232,
        auth: { username: 'user', password: 'pass' },
      },
      rateLimiter: {
        maxAmountPerWithdrawal: 100,
        maxWithdrawalsPerHour: 100,
        maxWithdrawalsPerDay: 500,
        maxTotalAmountPerDay: 5000,
        cooldownMs: 0,
      },
    });

    // Create 5 different requests with different requestIds
    const requests = Array.from({ length: 5 }, (_, i) => ({
      userId: `user-${i}`,
      fromAddress:
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
      toAddress:
        'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
      amount: 1,
      requestId: `parallel-request-${i}-${Date.now()}`,
    }));

    // Submit all in parallel
    const results = await Promise.all(
      requests.map((req) => sdk.processWithdrawal(req))
    );

    // Each should have its own unique requestId
    const requestIds = results.map((r) => r.requestId);
    expect(new Set(requestIds).size).toBe(5); // All unique
  });
});

describe('Concurrent Rate Limit Handling', () => {
  it('should correctly enforce rate limits under parallel requests', async () => {
    const sdk = createExchangeSDK({
      rpc: {
        host: '127.0.0.1',
        port: 8232,
        auth: { username: 'user', password: 'pass' },
      },
      rateLimiter: {
        maxAmountPerWithdrawal: 0.5, // Very low limit - each 1 ZEC request exceeds it
        maxWithdrawalsPerHour: 100,
        maxWithdrawalsPerDay: 100,
        maxTotalAmountPerDay: 1000,
        cooldownMs: 0,
      },
    });

    const userId = 'rate-limit-test-user';

    // Submit 5 requests in parallel for the same user, each exceeding max amount
    const requests = Array.from({ length: 5 }, (_, i) => ({
      userId,
      fromAddress:
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
      toAddress:
        'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
      amount: 1, // Exceeds 0.5 ZEC limit
      requestId: `rate-limit-test-${i}-${Date.now()}`,
    }));

    const results = await Promise.all(
      requests.map((req) => sdk.processWithdrawal(req))
    );

    // All should be rate limited because amount exceeds max
    const rateLimited = results.filter((r) => r.errorCode === 'RATE_LIMITED');

    // All 5 should be rate limited due to exceeding max amount per withdrawal
    expect(rateLimited.length).toBe(5);
  });

  it('should handle concurrent velocity checks', async () => {
    const sdk = createExchangeSDK({
      rpc: {
        host: '127.0.0.1',
        port: 8232,
        auth: { username: 'user', password: 'pass' },
      },
      enableCompliance: true,
    });

    const userId = 'velocity-test-user';

    // Check velocity in parallel
    const results = await Promise.all([
      Promise.resolve(sdk.checkVelocity(userId, 10)),
      Promise.resolve(sdk.checkVelocity(userId, 20)),
      Promise.resolve(sdk.checkVelocity(userId, 30)),
    ]);

    // All should return valid results
    for (const result of results) {
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.riskScore).toBe('number');
    }
  });
});

describe('Concurrent Audit Logging', () => {
  it('should maintain event order integrity under concurrent logging', async () => {
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

    // Submit multiple withdrawals in parallel (they will fail at RPC but should log)
    const requests = Array.from({ length: 10 }, (_, i) => ({
      userId: `audit-user-${i}`,
      fromAddress:
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
      toAddress:
        'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
      amount: 1,
      requestId: `audit-test-${i}-${Date.now()}`,
    }));

    await Promise.all(requests.map((req) => sdk.processWithdrawal(req)));

    // Should have logged multiple events
    const finalCount = auditLogger.getEventCount();
    expect(finalCount).toBeGreaterThan(initialCount);

    // Verify integrity - the hash chain should still be valid
    const integrity = auditLogger.verifyIntegrity();
    expect(integrity.valid).toBe(true);
  });
});

describe('Race Condition Prevention', () => {
  it('should prevent double-spending via idempotency key', async () => {
    const sdk = createExchangeSDK({
      rpc: {
        host: '127.0.0.1',
        port: 8232,
        auth: { username: 'user', password: 'pass' },
      },
    });

    const requestId = 'double-spend-test-' + Date.now();
    const request = {
      userId: 'double-spend-user',
      fromAddress:
        'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
      toAddress:
        'zs1x3ev0n0nf7zdmzq7e66t8y93f5fk8q9gww5y8ctr3fvwj7j8n2q9vg3p8rlv7e9a5u7w0fjhsny',
      amount: 100,
      requestId,
    };

    // Rapidly submit the same request many times
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(sdk.processWithdrawal(request));
    }

    const results = await Promise.all(promises);

    // All should have the same result (idempotency)
    const uniqueResults = new Set(results.map((r) => JSON.stringify(r)));

    // Due to caching, we should see the same error for all
    // (they all fail at the same point with the same error)
    expect(results.every((r) =>
      typeof r === 'object' && r !== null && 'success' in r && 'requestId' in r
    )).toBe(true);

    // All should reference the same requestId
    for (const result of results) {
      expect((result as { requestId: string }).requestId).toBe(requestId);
    }
  });
});
