/**
 * Rate Limiter Tests
 *
 * Tests for the WithdrawalRateLimiter class.
 */

import {
  WithdrawalRateLimiter,
  createRateLimiter,
  createConservativeRateLimiter,
  createHighVolumeRateLimiter,
} from '../src/security/rate-limiter.js';

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
      maxAmountPerWithdrawal: 100,
      maxTotalAmountPerDay: 500,
      cooldownMs: 60000, // 1 minute
    });
  });

  describe('checkLimit', () => {
    it('should allow first withdrawal', () => {
      const result = limiter.checkLimit('user-1', 10);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should enforce hourly withdrawal limit', () => {
      // Make 5 withdrawals (at the limit)
      for (let i = 0; i < 5; i++) {
        limiter.recordWithdrawal('user-1', 10);
        advanceTime(61000); // Skip cooldown
      }

      // 6th should be denied
      const result = limiter.checkLimit('user-1', 10);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Hourly');
    });

    it('should enforce daily withdrawal limit', () => {
      const dayLimiter = createTestLimiter({
        maxWithdrawalsPerHour: 100, // High hourly limit
        maxWithdrawalsPerDay: 5,
        maxAmountPerWithdrawal: 100,
        maxTotalAmountPerDay: 10000,
        cooldownMs: 0, // No cooldown
      });

      // Make 5 withdrawals
      for (let i = 0; i < 5; i++) {
        dayLimiter.recordWithdrawal('user-1', 10);
      }

      // 6th should be denied
      const result = dayLimiter.checkLimit('user-1', 10);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily');
    });

    it('should enforce max amount per withdrawal', () => {
      const result = limiter.checkLimit('user-1', 150); // Over 100 limit

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds maximum');
    });

    it('should enforce daily total amount limit', () => {
      // Use up most of the daily limit
      limiter.recordWithdrawal('user-1', 450);
      advanceTime(61000); // Skip cooldown

      // Try to withdraw more than remaining
      const result = limiter.checkLimit('user-1', 100); // Only 50 remaining

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily amount limit');
    });

    it('should enforce cooldown period', () => {
      limiter.recordWithdrawal('user-1', 10);

      // Try immediately
      const result = limiter.checkLimit('user-1', 10);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Cooldown');
      expect(result.retryAfterMs).toBeDefined();
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should allow after cooldown expires', () => {
      limiter.recordWithdrawal('user-1', 10);

      // Advance past cooldown
      advanceTime(61000);

      const result = limiter.checkLimit('user-1', 10);

      expect(result.allowed).toBe(true);
    });

    it('should track separate limits per user', () => {
      // User 1 makes withdrawals
      limiter.recordWithdrawal('user-1', 10);

      // User 2 should not be affected
      const result = limiter.checkLimit('user-2', 10);

      expect(result.allowed).toBe(true);
    });

    it('should include usage statistics in result', () => {
      limiter.recordWithdrawal('user-1', 50);
      advanceTime(61000);

      const result = limiter.checkLimit('user-1', 10);

      expect(result.usage).toBeDefined();
      expect(result.usage.withdrawalsThisDay).toBe(1);
      expect(result.usage.totalAmountToday).toBe(50);
    });
  });

  describe('recordWithdrawal', () => {
    it('should record withdrawal for tracking', () => {
      limiter.recordWithdrawal('user-1', 25);

      const remaining = limiter.getRemainingLimit('user-1');

      expect(remaining.amountRemainingToday).toBe(475);
    });

    it('should update last withdrawal time', () => {
      const before = limiter.getRemainingLimit('user-1');
      expect(before.cooldownRemainingMs).toBe(0);

      limiter.recordWithdrawal('user-1', 10);

      const after = limiter.getRemainingLimit('user-1');
      expect(after.cooldownRemainingMs).toBeGreaterThan(0);
    });
  });

  describe('getRemainingLimit', () => {
    it('should return full limits for new user', () => {
      const remaining = limiter.getRemainingLimit('new-user');

      expect(remaining.withdrawalsRemainingHour).toBe(5);
      expect(remaining.withdrawalsRemainingDay).toBe(20);
      expect(remaining.maxSingleWithdrawal).toBe(100);
      expect(remaining.amountRemainingToday).toBe(500);
      expect(remaining.cooldownRemainingMs).toBe(0);
    });

    it('should reflect consumed limits', () => {
      limiter.recordWithdrawal('user-1', 100);
      advanceTime(61000);
      limiter.recordWithdrawal('user-1', 100);

      const remaining = limiter.getRemainingLimit('user-1');

      expect(remaining.withdrawalsRemainingHour).toBe(3);
      expect(remaining.withdrawalsRemainingDay).toBe(18);
      expect(remaining.amountRemainingToday).toBe(300);
    });

    it('should include reset timestamps', () => {
      const remaining = limiter.getRemainingLimit('user-1');

      expect(remaining.hourResetAt).toBeGreaterThan(currentTime);
      expect(remaining.dayResetAt).toBeGreaterThan(currentTime);
    });
  });

  describe('resetUser', () => {
    it('should reset a user\'s limits', () => {
      limiter.recordWithdrawal('user-1', 100);
      advanceTime(61000);
      limiter.recordWithdrawal('user-1', 100);

      limiter.resetUser('user-1');

      const remaining = limiter.getRemainingLimit('user-1');
      expect(remaining.amountRemainingToday).toBe(500);
      expect(remaining.withdrawalsRemainingDay).toBe(20);
    });
  });

  describe('resetAll', () => {
    it('should reset all users', () => {
      limiter.recordWithdrawal('user-1', 100);
      limiter.recordWithdrawal('user-2', 100);

      limiter.resetAll();

      const remaining1 = limiter.getRemainingLimit('user-1');
      const remaining2 = limiter.getRemainingLimit('user-2');

      expect(remaining1.amountRemainingToday).toBe(500);
      expect(remaining2.amountRemainingToday).toBe(500);
    });
  });

  describe('getConfig', () => {
    it('should return the configuration', () => {
      const config = limiter.getConfig();

      expect(config.maxWithdrawalsPerHour).toBe(5);
      expect(config.maxWithdrawalsPerDay).toBe(20);
      expect(config.maxAmountPerWithdrawal).toBe(100);
      expect(config.maxTotalAmountPerDay).toBe(500);
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
        maxAmountPerWithdrawal: 100,
        maxTotalAmountPerDay: 10000,
        cooldownMs: 0,
        useSlidingWindow: true,
      });

      // Make 3 withdrawals at start
      slidingLimiter.recordWithdrawal('user-1', 10);
      slidingLimiter.recordWithdrawal('user-1', 10);
      slidingLimiter.recordWithdrawal('user-1', 10);

      // Should be blocked
      let result = slidingLimiter.checkLimit('user-1', 10);
      expect(result.allowed).toBe(false);

      // Advance 30 minutes - still blocked
      advanceTime(30 * 60 * 1000);
      result = slidingLimiter.checkLimit('user-1', 10);
      expect(result.allowed).toBe(false);

      // Advance to 61 minutes - should be allowed (sliding window)
      advanceTime(31 * 60 * 1000);
      result = slidingLimiter.checkLimit('user-1', 10);
      expect(result.allowed).toBe(true);
    });
  });

  describe('day boundary cleanup', () => {
    it('should clean up records older than 24 hours', () => {
      limiter.recordWithdrawal('user-1', 100);

      // Advance 25 hours
      advanceTime(25 * 60 * 60 * 1000);

      const remaining = limiter.getRemainingLimit('user-1');

      // Old withdrawal should be cleaned up
      expect(remaining.amountRemainingToday).toBe(500);
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
        new WithdrawalRateLimiter({ maxAmountPerWithdrawal: 0 });
      }).toThrow();
    });

    it('should reject invalid maxTotalAmountPerDay', () => {
      expect(() => {
        new WithdrawalRateLimiter({ maxTotalAmountPerDay: -100 });
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
