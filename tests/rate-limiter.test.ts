/**
 * Rate Limiter Tests
 *
 * Tests for the WithdrawalRateLimiter class.
 * All amounts are in zatoshis (1 ZEC = 100_000_000 zatoshis).
 */

import {
  WithdrawalRateLimiter,
  createRateLimiter,
  createConservativeRateLimiter,
  createHighVolumeRateLimiter,
} from '../src/security/rate-limiter.js';
import { MemoryRateLimitStore } from '../src/storage/index.js';

// Helper constants for zatoshis (1 ZEC = 100_000_000 zatoshis)
const ZAT = 100_000_000n;

describe('WithdrawalRateLimiter', () => {
  let limiter: WithdrawalRateLimiter;
  let currentTime: number;

  // Helper to create a limiter with controlled time
  const createTestLimiter = (config = {}): WithdrawalRateLimiter => {
    currentTime = Date.now();
    return new WithdrawalRateLimiter(config, () => currentTime);
  };

  // Helper to advance time
  const advanceTime = (ms: number): void => {
    currentTime += ms;
  };

  beforeEach(() => {
    limiter = createTestLimiter({
      maxWithdrawalsPerHour: 5,
      maxWithdrawalsPerDay: 20,
      maxAmountPerWithdrawal: 100n * ZAT, // 100 ZEC
      maxTotalAmountPerDay: 500n * ZAT, // 500 ZEC
      cooldownMs: 60000, // 1 minute
    });
  });

  describe('checkLimit', () => {
    it('should allow first withdrawal', () => {
      const result = limiter.checkLimit('user-1', 10n * ZAT);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should enforce hourly withdrawal limit', () => {
      // Make 5 withdrawals (at the limit)
      for (let i = 0; i < 5; i++) {
        limiter.recordWithdrawal('user-1', 10n * ZAT);
        advanceTime(61000); // Skip cooldown
      }

      // 6th should be denied
      const result = limiter.checkLimit('user-1', 10n * ZAT);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Hourly');
    });

    it('should enforce daily withdrawal limit', () => {
      const dayLimiter = createTestLimiter({
        maxWithdrawalsPerHour: 100, // High hourly limit
        maxWithdrawalsPerDay: 5,
        maxAmountPerWithdrawal: 100n * ZAT,
        maxTotalAmountPerDay: 10000n * ZAT,
        cooldownMs: 0, // No cooldown
      });

      // Make 5 withdrawals
      for (let i = 0; i < 5; i++) {
        dayLimiter.recordWithdrawal('user-1', 10n * ZAT);
      }

      // 6th should be denied
      const result = dayLimiter.checkLimit('user-1', 10n * ZAT);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily');
    });

    it('should enforce max amount per withdrawal', () => {
      const result = limiter.checkLimit('user-1', 150n * ZAT); // Over 100 ZEC limit

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds maximum');
    });

    it('should enforce daily total amount limit', () => {
      // Use up most of the daily limit
      limiter.recordWithdrawal('user-1', 450n * ZAT);
      advanceTime(61000); // Skip cooldown

      // Try to withdraw more than remaining
      const result = limiter.checkLimit('user-1', 100n * ZAT); // Only 50 ZEC remaining

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily amount limit');
    });

    it('should enforce cooldown period', () => {
      limiter.recordWithdrawal('user-1', 10n * ZAT);

      // Try immediately
      const result = limiter.checkLimit('user-1', 10n * ZAT);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cooldown');
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should allow after cooldown expires', () => {
      limiter.recordWithdrawal('user-1', 10n * ZAT);

      // Advance past cooldown
      advanceTime(61000);

      const result = limiter.checkLimit('user-1', 10n * ZAT);

      expect(result.allowed).toBe(true);
    });

    it('should track separate limits per user', () => {
      // User 1 makes withdrawals
      limiter.recordWithdrawal('user-1', 10n * ZAT);

      // User 2 should not be affected
      const result = limiter.checkLimit('user-2', 10n * ZAT);

      expect(result.allowed).toBe(true);
    });

    it('should include usage statistics in result', () => {
      limiter.recordWithdrawal('user-1', 50n * ZAT);
      advanceTime(61000);

      const result = limiter.checkLimit('user-1', 10n * ZAT);

      expect(result.usage).toBeDefined();
      expect(result.usage.withdrawalsThisDay).toBe(1);
      expect(result.usage.totalAmountToday).toBe(50n * ZAT);
    });
  });

  describe('recordWithdrawal', () => {
    it('should record withdrawal for tracking', () => {
      limiter.recordWithdrawal('user-1', 25n * ZAT);

      const remaining = limiter.getRemainingLimit('user-1');

      expect(remaining.amountRemainingToday).toBe(475n * ZAT);
    });

    it('should update last withdrawal time', () => {
      const before = limiter.getRemainingLimit('user-1');
      expect(before.cooldownRemainingMs).toBe(0);

      limiter.recordWithdrawal('user-1', 10n * ZAT);

      const after = limiter.getRemainingLimit('user-1');
      expect(after.cooldownRemainingMs).toBeGreaterThan(0);
    });
  });

  describe('getRemainingLimit', () => {
    it('should return full limits for new user', () => {
      const remaining = limiter.getRemainingLimit('new-user');

      expect(remaining.withdrawalsRemainingHour).toBe(5);
      expect(remaining.withdrawalsRemainingDay).toBe(20);
      expect(remaining.maxSingleWithdrawal).toBe(100n * ZAT);
      expect(remaining.amountRemainingToday).toBe(500n * ZAT);
      expect(remaining.cooldownRemainingMs).toBe(0);
    });

    it('should reflect consumed limits', () => {
      limiter.recordWithdrawal('user-1', 100n * ZAT);
      advanceTime(61000);
      limiter.recordWithdrawal('user-1', 100n * ZAT);

      const remaining = limiter.getRemainingLimit('user-1');

      expect(remaining.withdrawalsRemainingHour).toBe(3);
      expect(remaining.withdrawalsRemainingDay).toBe(18);
      expect(remaining.amountRemainingToday).toBe(300n * ZAT);
    });

    it('should include reset timestamps', () => {
      const remaining = limiter.getRemainingLimit('user-1');

      expect(remaining.hourResetAt).toBeGreaterThan(currentTime);
      expect(remaining.dayResetAt).toBeGreaterThan(currentTime);
    });
  });

  describe('resetUser', () => {
    it('should reset a user\'s limits', () => {
      limiter.recordWithdrawal('user-1', 100n * ZAT);
      advanceTime(61000);
      limiter.recordWithdrawal('user-1', 100n * ZAT);

      limiter.resetUser('user-1');

      const remaining = limiter.getRemainingLimit('user-1');
      expect(remaining.amountRemainingToday).toBe(500n * ZAT);
      expect(remaining.withdrawalsRemainingDay).toBe(20);
    });
  });

  describe('resetAll', () => {
    it('should reset all users', () => {
      limiter.recordWithdrawal('user-1', 100n * ZAT);
      limiter.recordWithdrawal('user-2', 100n * ZAT);

      limiter.resetAll();

      const remaining1 = limiter.getRemainingLimit('user-1');
      const remaining2 = limiter.getRemainingLimit('user-2');

      expect(remaining1.amountRemainingToday).toBe(500n * ZAT);
      expect(remaining2.amountRemainingToday).toBe(500n * ZAT);
    });
  });

  describe('getConfig', () => {
    it('should return the configuration', () => {
      const config = limiter.getConfig();

      expect(config.maxWithdrawalsPerHour).toBe(5);
      expect(config.maxWithdrawalsPerDay).toBe(20);
      expect(config.maxAmountPerWithdrawal).toBe(100n * ZAT);
      expect(config.maxTotalAmountPerDay).toBe(500n * ZAT);
      expect(config.cooldownMs).toBe(60000);
    });

    it('should return a copy, not the internal object', () => {
      const config = limiter.getConfig();
      (config as { maxWithdrawalsPerHour: number }).maxWithdrawalsPerHour = 999;

      expect(limiter.getConfig().maxWithdrawalsPerHour).toBe(5);
    });
  });

  describe('sliding window', () => {
    it('should use sliding window for hourly counts', () => {
      const slidingLimiter = createTestLimiter({
        maxWithdrawalsPerHour: 3,
        maxWithdrawalsPerDay: 100,
        maxAmountPerWithdrawal: 100n * ZAT,
        maxTotalAmountPerDay: 10000n * ZAT,
        cooldownMs: 0,
        useSlidingWindow: true,
      });

      // Make 3 withdrawals at start
      slidingLimiter.recordWithdrawal('user-1', 10n * ZAT);
      slidingLimiter.recordWithdrawal('user-1', 10n * ZAT);
      slidingLimiter.recordWithdrawal('user-1', 10n * ZAT);

      // Should be blocked
      let result = slidingLimiter.checkLimit('user-1', 10n * ZAT);
      expect(result.allowed).toBe(false);

      // Advance 30 minutes - still blocked
      advanceTime(30 * 60 * 1000);
      result = slidingLimiter.checkLimit('user-1', 10n * ZAT);
      expect(result.allowed).toBe(false);

      // Advance to 61 minutes - should be allowed (sliding window)
      advanceTime(31 * 60 * 1000);
      result = slidingLimiter.checkLimit('user-1', 10n * ZAT);
      expect(result.allowed).toBe(true);
    });
  });

  describe('day boundary cleanup', () => {
    it('should clean up records older than 24 hours', () => {
      limiter.recordWithdrawal('user-1', 100n * ZAT);

      // Advance 25 hours
      advanceTime(25 * 60 * 60 * 1000);

      const remaining = limiter.getRemainingLimit('user-1');

      // Old withdrawal should be cleaned up
      expect(remaining.amountRemainingToday).toBe(500n * ZAT);
      expect(remaining.withdrawalsRemainingDay).toBe(20);
    });
  });

  describe('configuration validation', () => {
    it('should reject invalid maxWithdrawalsPerHour', () => {
      expect(() => {
        new WithdrawalRateLimiter({ maxWithdrawalsPerHour: 0 });
      }).toThrow();
    });

    it('should reject invalid maxWithdrawalsPerDay', () => {
      expect(() => {
        new WithdrawalRateLimiter({ maxWithdrawalsPerDay: -1 });
      }).toThrow();
    });

    it('should reject invalid maxAmountPerWithdrawal', () => {
      expect(() => {
        new WithdrawalRateLimiter({ maxAmountPerWithdrawal: 0n });
      }).toThrow();
    });

    it('should reject invalid maxTotalAmountPerDay', () => {
      expect(() => {
        new WithdrawalRateLimiter({ maxTotalAmountPerDay: -100n });
      }).toThrow();
    });

    it('should reject negative cooldownMs', () => {
      expect(() => {
        new WithdrawalRateLimiter({ cooldownMs: -1 });
      }).toThrow();
    });
  });

  describe('factory functions', () => {
    it('createRateLimiter should create with defaults', () => {
      const limiter = createRateLimiter();

      expect(limiter).toBeInstanceOf(WithdrawalRateLimiter);
    });

    it('createRateLimiter should accept custom config', () => {
      const limiter = createRateLimiter({
        maxWithdrawalsPerHour: 3,
      });

      expect(limiter.getConfig().maxWithdrawalsPerHour).toBe(3);
    });

    it('createConservativeRateLimiter should create conservative limiter', () => {
      const limiter = createConservativeRateLimiter();
      const config = limiter.getConfig();

      expect(config.maxWithdrawalsPerHour).toBe(3);
      expect(config.maxWithdrawalsPerDay).toBe(10);
      expect(config.cooldownMs).toBe(300000); // 5 minutes
    });

    it('createHighVolumeRateLimiter should create high-volume limiter', () => {
      const limiter = createHighVolumeRateLimiter();
      const config = limiter.getConfig();

      expect(config.maxWithdrawalsPerHour).toBe(100);
      expect(config.maxWithdrawalsPerDay).toBe(500);
      expect(config.cooldownMs).toBe(10000); // 10 seconds
    });
  });
});

describe('WithdrawalRateLimiter with external store', () => {
  let limiter: WithdrawalRateLimiter;
  let store: MemoryRateLimitStore;
  let currentTime: number;

  // Helper to create a limiter with controlled time and external store
  const createTestLimiter = (): WithdrawalRateLimiter => {
    currentTime = Date.now();
    store = new MemoryRateLimitStore();
    return new WithdrawalRateLimiter(
      {
        maxWithdrawalsPerHour: 5,
        maxWithdrawalsPerDay: 20,
        maxAmountPerWithdrawal: 100n * ZAT,
        maxTotalAmountPerDay: 500n * ZAT,
        cooldownMs: 60000,
        store,
      },
      () => currentTime
    );
  };

  // Helper to advance time
  const advanceTime = (ms: number): void => {
    currentTime += ms;
  };

  beforeEach(() => {
    limiter = createTestLimiter();
  });

  describe('hasExternalStore', () => {
    it('should return true when store is configured', () => {
      expect(limiter.hasExternalStore()).toBe(true);
    });

    it('should return false when no store is configured', () => {
      const noStoreLimiter = new WithdrawalRateLimiter();
      expect(noStoreLimiter.hasExternalStore()).toBe(false);
    });
  });

  describe('checkLimitAsync', () => {
    it('should allow first withdrawal', async () => {
      const result = await limiter.checkLimitAsync('user-1', 10n * ZAT);
      expect(result.allowed).toBe(true);
    });

    it('should enforce limits using external store', async () => {
      // Set a fixed time at the start of an hour to avoid boundary issues
      // This ensures all 5 withdrawals are in the same hour
      const fixedHourStart = new Date();
      fixedHourStart.setUTCMinutes(5, 0, 0); // 5 minutes into the hour
      currentTime = fixedHourStart.getTime();

      // Recreate limiter with the fixed time
      store = new MemoryRateLimitStore();
      limiter = new WithdrawalRateLimiter(
        {
          maxWithdrawalsPerHour: 5,
          maxWithdrawalsPerDay: 20,
          maxAmountPerWithdrawal: 100n * ZAT,
          maxTotalAmountPerDay: 500n * ZAT,
          cooldownMs: 60000,
          store,
        },
        () => currentTime
      );

      // Record 5 withdrawals through the async API
      for (let i = 0; i < 5; i++) {
        await limiter.recordWithdrawalAsync('user-1', 10n * ZAT);
        advanceTime(61000); // Skip cooldown (5 * 61s = 305s < 55 min remaining in hour)
      }

      // 6th should be denied (hourly limit)
      const result = await limiter.checkLimitAsync('user-1', 10n * ZAT);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Hourly');
    });

    it('should enforce cooldown using external store', async () => {
      await limiter.recordWithdrawalAsync('user-1', 10n * ZAT);

      // Try immediately
      const result = await limiter.checkLimitAsync('user-1', 10n * ZAT);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cooldown');
    });

    it('should enforce daily amount limit using external store', async () => {
      // Record a large withdrawal
      await limiter.recordWithdrawalAsync('user-1', 450n * ZAT);
      advanceTime(61000);

      // Try to exceed daily limit
      const result = await limiter.checkLimitAsync('user-1', 100n * ZAT);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily amount');
    });
  });

  describe('recordWithdrawalAsync', () => {
    it('should persist withdrawal to external store', async () => {
      await limiter.recordWithdrawalAsync('user-1', 25n * ZAT);

      // Verify data is in the store
      const data = await store.getUserLimits('user-1');
      expect(data).not.toBeNull();
      expect(data?.withdrawalsToday).toBe(1);
      expect(data?.amountToday).toBe(25n * ZAT);
    });

    it('should increment counts correctly', async () => {
      await limiter.recordWithdrawalAsync('user-1', 10n * ZAT);
      advanceTime(61000);
      await limiter.recordWithdrawalAsync('user-1', 20n * ZAT);

      const data = await store.getUserLimits('user-1');
      expect(data?.withdrawalsToday).toBe(2);
      expect(data?.amountToday).toBe(30n * ZAT);
    });

    it('should reset hourly count on new hour', async () => {
      await limiter.recordWithdrawalAsync('user-1', 10n * ZAT);

      // Advance past one hour
      advanceTime(61 * 60 * 1000);

      await limiter.recordWithdrawalAsync('user-1', 20n * ZAT);

      const data = await store.getUserLimits('user-1');
      expect(data?.withdrawalsThisHour).toBe(1); // Reset to 1 for new hour
      expect(data?.withdrawalsToday).toBe(2); // Still counting daily
    });
  });

  describe('getRemainingLimitAsync', () => {
    it('should return full limits for new user', async () => {
      const remaining = await limiter.getRemainingLimitAsync('new-user');

      expect(remaining.withdrawalsRemainingHour).toBe(5);
      expect(remaining.withdrawalsRemainingDay).toBe(20);
      expect(remaining.amountRemainingToday).toBe(500n * ZAT);
    });

    it('should reflect consumed limits from store', async () => {
      // Set a fixed time early in the hour to avoid boundary issues
      const fixedHourStart = new Date();
      fixedHourStart.setUTCMinutes(5, 0, 0);
      currentTime = fixedHourStart.getTime();

      // Recreate limiter with the fixed time
      store = new MemoryRateLimitStore();
      limiter = new WithdrawalRateLimiter(
        {
          maxWithdrawalsPerHour: 5,
          maxWithdrawalsPerDay: 20,
          maxAmountPerWithdrawal: 100n * ZAT,
          maxTotalAmountPerDay: 500n * ZAT,
          cooldownMs: 60000,
          store,
        },
        () => currentTime
      );

      await limiter.recordWithdrawalAsync('user-1', 100n * ZAT);
      advanceTime(61000);
      await limiter.recordWithdrawalAsync('user-1', 100n * ZAT);

      const remaining = await limiter.getRemainingLimitAsync('user-1');

      expect(remaining.withdrawalsRemainingHour).toBe(3);
      expect(remaining.withdrawalsRemainingDay).toBe(18);
      expect(remaining.amountRemainingToday).toBe(300n * ZAT);
    });
  });

  describe('resetUserAsync', () => {
    it('should reset user limits in external store', async () => {
      await limiter.recordWithdrawalAsync('user-1', 100n * ZAT);

      await limiter.resetUserAsync('user-1');

      const data = await store.getUserLimits('user-1');
      expect(data).toBeNull();

      // Verify limits are reset
      const remaining = await limiter.getRemainingLimitAsync('user-1');
      expect(remaining.amountRemainingToday).toBe(500n * ZAT);
    });
  });

  describe('fallback behavior', () => {
    it('should fallback to sync methods when no store', async () => {
      const noStoreLimiter = new WithdrawalRateLimiter({
        maxWithdrawalsPerHour: 5,
        cooldownMs: 0,
      });

      // These async methods should work by falling back to sync
      const result = await noStoreLimiter.checkLimitAsync('user-1', 10n * ZAT);
      expect(result.allowed).toBe(true);

      await noStoreLimiter.recordWithdrawalAsync('user-1', 10n * ZAT);

      const remaining = await noStoreLimiter.getRemainingLimitAsync('user-1');
      expect(remaining.withdrawalsRemainingHour).toBe(4);
    });
  });
});
