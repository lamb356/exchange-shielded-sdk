/**
 * Rate Limiter Module
 *
 * Provides rate limiting for withdrawal operations to prevent abuse
 * and ensure compliance with exchange policies.
 *
 * IMPORTANT: All monetary amounts are in zatoshis (bigint).
 * 1 ZEC = 100_000_000 zatoshis (10^8)
 *
 * @packageDocumentation
 */

import { zatoshisToZec } from '../utils/amounts.js';
import { RateLimitStore, UserLimitData } from '../storage/interfaces.js';

/**
 * Rate limit configuration
 *
 * All amounts are in zatoshis (1 ZEC = 100_000_000 zatoshis).
 */
export interface RateLimitConfig {
  /** Maximum withdrawals per hour per user */
  maxWithdrawalsPerHour: number;
  /** Maximum withdrawals per day per user */
  maxWithdrawalsPerDay: number;
  /** Maximum amount per single withdrawal in zatoshis (1 ZEC = 100_000_000n) */
  maxAmountPerWithdrawal: bigint;
  /** Maximum total amount per day per user in zatoshis (1 ZEC = 100_000_000n) */
  maxTotalAmountPerDay: bigint;
  /** Minimum cooldown between withdrawals in milliseconds */
  cooldownMs: number;
  /** Whether to enable sliding window rate limiting */
  useSlidingWindow?: boolean;
  /**
   * Optional pluggable store for distributed rate limiting.
   * If provided, rate limit state is stored externally (e.g., Redis).
   * If not provided, uses in-memory storage (not suitable for distributed deployments).
   */
  store?: RateLimitStore;
}

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Reason for denial if not allowed */
  reason?: string;
  /** Retry after this many milliseconds (for cooldown violations) */
  retryAfterMs?: number;
  /** Current usage statistics */
  usage: RateLimitUsage;
}

/**
 * Current usage statistics for a user
 *
 * All amounts are in zatoshis (1 ZEC = 100_000_000 zatoshis).
 */
export interface RateLimitUsage {
  /** Withdrawals in the current hour */
  withdrawalsThisHour: number;
  /** Withdrawals in the current day */
  withdrawalsThisDay: number;
  /** Total amount withdrawn today in zatoshis */
  totalAmountToday: bigint;
  /** Timestamp of last withdrawal */
  lastWithdrawalAt?: number;
}

/**
 * Remaining limits for a user
 *
 * All amounts are in zatoshis (1 ZEC = 100_000_000 zatoshis).
 */
export interface RemainingLimit {
  /** Remaining withdrawals this hour */
  withdrawalsRemainingHour: number;
  /** Remaining withdrawals this day */
  withdrawalsRemainingDay: number;
  /** Maximum amount for single withdrawal in zatoshis */
  maxSingleWithdrawal: bigint;
  /** Remaining total amount for today in zatoshis */
  amountRemainingToday: bigint;
  /** Milliseconds until cooldown expires (0 if not in cooldown) */
  cooldownRemainingMs: number;
  /** Timestamp when hour limit resets */
  hourResetAt: number;
  /** Timestamp when day limit resets */
  dayResetAt: number;
}

/**
 * Internal withdrawal record
 */
interface WithdrawalRecord {
  /** Withdrawal amount in zatoshis */
  amount: bigint;
  /** Timestamp of withdrawal */
  timestamp: number;
}

/**
 * User rate limit state
 */
interface UserRateLimitState {
  /** History of withdrawals (for sliding window) */
  withdrawals: WithdrawalRecord[];
  /** Timestamp of last withdrawal */
  lastWithdrawalAt?: number;
}

/**
 * Default rate limit configuration (amounts in zatoshis)
 */
const DEFAULT_CONFIG: RateLimitConfig = {
  maxWithdrawalsPerHour: 10,
  maxWithdrawalsPerDay: 50,
  maxAmountPerWithdrawal: 100_00000000n, // 100 ZEC in zatoshis
  maxTotalAmountPerDay: 1000_00000000n, // 1000 ZEC in zatoshis
  cooldownMs: 60000, // 1 minute
  useSlidingWindow: true,
};

/**
 * Time constants
 */
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Withdrawal Rate Limiter
 *
 * Enforces rate limits on withdrawal operations per user.
 * Supports configurable limits for:
 * - Maximum withdrawals per hour/day
 * - Maximum amount per withdrawal
 * - Maximum total amount per day
 * - Cooldown between withdrawals
 *
 * @example
 * ```typescript
 * const limiter = new WithdrawalRateLimiter({
 *   maxWithdrawalsPerHour: 5,
 *   maxWithdrawalsPerDay: 20,
 *   maxAmountPerWithdrawal: 10,
 *   maxTotalAmountPerDay: 100,
 *   cooldownMs: 60000
 * });
 *
 * // Check if withdrawal is allowed
 * const result = limiter.checkLimit('user-123', 5.0);
 * if (result.allowed) {
 *   // Process withdrawal
 *   limiter.recordWithdrawal('user-123', 5.0);
 * } else {
 *   console.log('Rate limited:', result.reason);
 * }
 * ```
 */
export class WithdrawalRateLimiter {
  /** Rate limit configuration */
  private readonly config: RateLimitConfig;

  /** Per-user rate limit state (used when no external store is provided) */
  private readonly userStates: Map<string, UserRateLimitState>;

  /** External store for distributed deployments */
  private readonly store?: RateLimitStore;

  /** Function to get current timestamp (for testing) */
  private readonly getNow: () => number;

  /**
   * Creates a new WithdrawalRateLimiter
   *
   * @param config - Rate limit configuration (including optional store)
   * @param getNow - Optional function to get current time (for testing)
   */
  constructor(config: Partial<RateLimitConfig> = {}, getNow?: () => number) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.userStates = new Map();
    this.store = config.store;
    this.getNow = getNow ?? (() => Date.now());

    // Validate configuration
    this.validateConfig();
  }

  /**
   * Returns whether this limiter uses an external store
   */
  hasExternalStore(): boolean {
    return this.store !== undefined;
  }

  /**
   * Validates the rate limit configuration
   */
  private validateConfig(): void {
    if (this.config.maxWithdrawalsPerHour <= 0) {
      throw new Error('maxWithdrawalsPerHour must be positive');
    }
    if (this.config.maxWithdrawalsPerDay <= 0) {
      throw new Error('maxWithdrawalsPerDay must be positive');
    }
    if (this.config.maxAmountPerWithdrawal <= 0n) {
      throw new Error('maxAmountPerWithdrawal must be positive');
    }
    if (this.config.maxTotalAmountPerDay <= 0n) {
      throw new Error('maxTotalAmountPerDay must be positive');
    }
    if (this.config.cooldownMs < 0) {
      throw new Error('cooldownMs cannot be negative');
    }
  }

  /**
   * Checks if a withdrawal is allowed for a user (sync version for in-memory store)
   *
   * @param userId - The user identifier
   * @param amountZatoshis - The withdrawal amount in zatoshis
   * @returns Rate limit check result
   */
  checkLimit(userId: string, amountZatoshis: bigint): RateLimitResult {
    const now = this.getNow();
    const state = this.getOrCreateUserState(userId);

    // Clean up old records
    this.cleanupOldRecords(state, now);

    // Calculate current usage
    const usage = this.calculateUsage(state, now);

    return this.evaluateLimits(userId, amountZatoshis, usage, state.lastWithdrawalAt, now);
  }

  /**
   * Checks if a withdrawal is allowed for a user (async version for external store)
   *
   * Use this method when using an external store for distributed rate limiting.
   *
   * @param userId - The user identifier
   * @param amountZatoshis - The withdrawal amount in zatoshis
   * @returns Promise resolving to rate limit check result
   */
  async checkLimitAsync(userId: string, amountZatoshis: bigint): Promise<RateLimitResult> {
    const now = this.getNow();

    if (this.store) {
      // Use external store
      const limitData = await this.store.getUserLimits(userId);
      const usage = this.calculateUsageFromStore(limitData, now);
      const lastWithdrawalAt = limitData?.lastWithdrawalTime;
      return this.evaluateLimits(userId, amountZatoshis, usage, lastWithdrawalAt, now);
    } else {
      // Fall back to sync version
      return this.checkLimit(userId, amountZatoshis);
    }
  }

  /**
   * Evaluates rate limits against current usage
   */
  private evaluateLimits(
    userId: string,
    amountZatoshis: bigint,
    usage: RateLimitUsage,
    lastWithdrawalAt: number | undefined,
    now: number
  ): RateLimitResult {
    // Check cooldown
    if (lastWithdrawalAt !== undefined) {
      const timeSinceLastWithdrawal = now - lastWithdrawalAt;
      if (timeSinceLastWithdrawal < this.config.cooldownMs) {
        const retryAfterMs = this.config.cooldownMs - timeSinceLastWithdrawal;
        return {
          allowed: false,
          reason: `Cooldown period active. Please wait ${Math.ceil(retryAfterMs / 1000)} seconds.`,
          retryAfterMs,
          usage,
        };
      }
    }

    // Check hourly limit
    if (usage.withdrawalsThisHour >= this.config.maxWithdrawalsPerHour) {
      return {
        allowed: false,
        reason: `Hourly withdrawal limit (${this.config.maxWithdrawalsPerHour}) exceeded`,
        usage,
      };
    }

    // Check daily limit
    if (usage.withdrawalsThisDay >= this.config.maxWithdrawalsPerDay) {
      return {
        allowed: false,
        reason: `Daily withdrawal limit (${this.config.maxWithdrawalsPerDay}) exceeded`,
        usage,
      };
    }

    // Check single withdrawal amount
    if (amountZatoshis > this.config.maxAmountPerWithdrawal) {
      const amountZec = zatoshisToZec(amountZatoshis);
      const maxZec = zatoshisToZec(this.config.maxAmountPerWithdrawal);
      return {
        allowed: false,
        reason: `Amount ${amountZec} ZEC exceeds maximum single withdrawal of ${maxZec} ZEC`,
        usage,
      };
    }

    // Check daily total amount
    const projectedTotalToday = usage.totalAmountToday + amountZatoshis;
    if (projectedTotalToday > this.config.maxTotalAmountPerDay) {
      const remainingZatoshis = this.config.maxTotalAmountPerDay - usage.totalAmountToday;
      const remainingZec = zatoshisToZec(remainingZatoshis);
      return {
        allowed: false,
        reason: `Daily amount limit exceeded. Maximum remaining: ${remainingZec.toFixed(8)} ZEC`,
        usage,
      };
    }

    // All checks passed
    return {
      allowed: true,
      usage,
    };
  }

  /**
   * Records a successful withdrawal (sync version for in-memory store)
   *
   * @param userId - The user identifier
   * @param amountZatoshis - The withdrawal amount in zatoshis
   */
  recordWithdrawal(userId: string, amountZatoshis: bigint): void {
    const now = this.getNow();
    const state = this.getOrCreateUserState(userId);

    // Clean up old records first
    this.cleanupOldRecords(state, now);

    // Add new withdrawal record
    state.withdrawals.push({
      amount: amountZatoshis,
      timestamp: now,
    });

    state.lastWithdrawalAt = now;
  }

  /**
   * Records a successful withdrawal (async version for external store)
   *
   * Use this method when using an external store for distributed rate limiting.
   *
   * @param userId - The user identifier
   * @param amountZatoshis - The withdrawal amount in zatoshis
   */
  async recordWithdrawalAsync(userId: string, amountZatoshis: bigint): Promise<void> {
    const now = this.getNow();

    if (this.store) {
      // Get current state from store
      let limitData = await this.store.getUserLimits(userId);

      // Update window starts if needed
      const hourStart = this.getHourStart(now);
      const dayStart = this.getDayStart(now);

      if (!limitData) {
        // Create new user data
        limitData = {
          userId,
          withdrawalsThisHour: 1,
          withdrawalsToday: 1,
          amountToday: amountZatoshis,
          lastWithdrawalTime: now,
          hourlyWindowStart: hourStart,
          dailyWindowStart: dayStart,
        };
      } else {
        // Update existing data
        // Reset hourly count if in a new hour
        if (limitData.hourlyWindowStart < hourStart) {
          limitData.withdrawalsThisHour = 1;
          limitData.hourlyWindowStart = hourStart;
        } else {
          limitData.withdrawalsThisHour++;
        }

        // Reset daily count if in a new day
        if (limitData.dailyWindowStart < dayStart) {
          limitData.withdrawalsToday = 1;
          limitData.amountToday = amountZatoshis;
          limitData.dailyWindowStart = dayStart;
        } else {
          limitData.withdrawalsToday++;
          limitData.amountToday += amountZatoshis;
        }

        limitData.lastWithdrawalTime = now;
      }

      await this.store.setUserLimits(userId, limitData);
    } else {
      // Fall back to sync version
      this.recordWithdrawal(userId, amountZatoshis);
    }
  }

  /**
   * Calculates usage from store data
   */
  private calculateUsageFromStore(limitData: UserLimitData | null, now: number): RateLimitUsage {
    if (!limitData) {
      return {
        withdrawalsThisHour: 0,
        withdrawalsThisDay: 0,
        totalAmountToday: 0n,
      };
    }

    const hourStart = this.getHourStart(now);
    const dayStart = this.getDayStart(now);

    // Reset counts if windows have expired
    let withdrawalsThisHour = limitData.withdrawalsThisHour;
    let withdrawalsThisDay = limitData.withdrawalsToday;
    let totalAmountToday = limitData.amountToday;

    if (limitData.hourlyWindowStart < hourStart) {
      withdrawalsThisHour = 0;
    }

    if (limitData.dailyWindowStart < dayStart) {
      withdrawalsThisDay = 0;
      totalAmountToday = 0n;
    }

    return {
      withdrawalsThisHour,
      withdrawalsThisDay,
      totalAmountToday,
      lastWithdrawalAt: limitData.lastWithdrawalTime,
    };
  }

  /**
   * Gets the remaining limits for a user (sync version for in-memory store)
   *
   * @param userId - The user identifier
   * @returns Remaining limit information
   */
  getRemainingLimit(userId: string): RemainingLimit {
    const now = this.getNow();
    const state = this.getOrCreateUserState(userId);

    // Clean up old records
    this.cleanupOldRecords(state, now);

    // Calculate current usage
    const usage = this.calculateUsage(state, now);

    return this.calculateRemainingLimit(usage, state.lastWithdrawalAt, now);
  }

  /**
   * Gets the remaining limits for a user (async version for external store)
   *
   * Use this method when using an external store for distributed rate limiting.
   *
   * @param userId - The user identifier
   * @returns Promise resolving to remaining limit information
   */
  async getRemainingLimitAsync(userId: string): Promise<RemainingLimit> {
    const now = this.getNow();

    if (this.store) {
      const limitData = await this.store.getUserLimits(userId);
      const usage = this.calculateUsageFromStore(limitData, now);
      return this.calculateRemainingLimit(usage, limitData?.lastWithdrawalTime, now);
    } else {
      return this.getRemainingLimit(userId);
    }
  }

  /**
   * Calculates remaining limits from usage data
   */
  private calculateRemainingLimit(
    usage: RateLimitUsage,
    lastWithdrawalAt: number | undefined,
    now: number
  ): RemainingLimit {
    // Calculate cooldown remaining
    let cooldownRemainingMs = 0;
    if (lastWithdrawalAt !== undefined) {
      const timeSinceLastWithdrawal = now - lastWithdrawalAt;
      if (timeSinceLastWithdrawal < this.config.cooldownMs) {
        cooldownRemainingMs = this.config.cooldownMs - timeSinceLastWithdrawal;
      }
    }

    // Calculate reset times
    const hourResetAt = this.getNextHourBoundary(now);
    const dayResetAt = this.getNextDayBoundary(now);

    // Calculate remaining amount (bigint comparison)
    const remainingAmount = this.config.maxTotalAmountPerDay > usage.totalAmountToday
      ? this.config.maxTotalAmountPerDay - usage.totalAmountToday
      : 0n;

    return {
      withdrawalsRemainingHour: Math.max(
        0,
        this.config.maxWithdrawalsPerHour - usage.withdrawalsThisHour
      ),
      withdrawalsRemainingDay: Math.max(
        0,
        this.config.maxWithdrawalsPerDay - usage.withdrawalsThisDay
      ),
      maxSingleWithdrawal: this.config.maxAmountPerWithdrawal,
      amountRemainingToday: remainingAmount,
      cooldownRemainingMs,
      hourResetAt,
      dayResetAt,
    };
  }

  /**
   * Resets the rate limit state for a user (sync version for in-memory store)
   *
   * @param userId - The user identifier
   */
  resetUser(userId: string): void {
    this.userStates.delete(userId);
  }

  /**
   * Resets the rate limit state for a user (async version for external store)
   *
   * Use this method when using an external store for distributed rate limiting.
   *
   * @param userId - The user identifier
   */
  async resetUserAsync(userId: string): Promise<void> {
    if (this.store) {
      await this.store.reset(userId);
    } else {
      this.resetUser(userId);
    }
  }

  /**
   * Resets all rate limit state (in-memory only)
   *
   * Note: This only clears the in-memory state. For external stores,
   * you need to clear the store directly.
   */
  resetAll(): void {
    this.userStates.clear();
  }

  /**
   * Gets the current configuration
   */
  getConfig(): Readonly<RateLimitConfig> {
    return { ...this.config };
  }

  /**
   * Gets or creates user state
   */
  private getOrCreateUserState(userId: string): UserRateLimitState {
    let state = this.userStates.get(userId);
    if (!state) {
      state = {
        withdrawals: [],
      };
      this.userStates.set(userId, state);
    }
    return state;
  }

  /**
   * Cleans up withdrawal records older than 24 hours
   */
  private cleanupOldRecords(state: UserRateLimitState, now: number): void {
    const cutoff = now - MS_PER_DAY;
    state.withdrawals = state.withdrawals.filter((w) => w.timestamp >= cutoff);
  }

  /**
   * Calculates current usage for a user
   */
  private calculateUsage(state: UserRateLimitState, now: number): RateLimitUsage {
    const hourAgo = now - MS_PER_HOUR;
    const dayStart = this.getDayStart(now);

    let withdrawalsThisHour = 0;
    let withdrawalsThisDay = 0;
    let totalAmountToday = 0n;

    for (const withdrawal of state.withdrawals) {
      if (withdrawal.timestamp >= dayStart) {
        withdrawalsThisDay++;
        totalAmountToday += withdrawal.amount;
      }

      if (this.config.useSlidingWindow) {
        // Sliding window: count withdrawals in the last hour
        if (withdrawal.timestamp >= hourAgo) {
          withdrawalsThisHour++;
        }
      } else {
        // Fixed window: count withdrawals since the start of the current hour
        const hourStart = this.getHourStart(now);
        if (withdrawal.timestamp >= hourStart) {
          withdrawalsThisHour++;
        }
      }
    }

    return {
      withdrawalsThisHour,
      withdrawalsThisDay,
      totalAmountToday,
      lastWithdrawalAt: state.lastWithdrawalAt,
    };
  }

  /**
   * Gets the start of the current day (midnight UTC)
   */
  private getDayStart(now: number): number {
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Gets the start of the current hour
   */
  private getHourStart(now: number): number {
    const date = new Date(now);
    date.setUTCMinutes(0, 0, 0);
    return date.getTime();
  }

  /**
   * Gets the next hour boundary
   */
  private getNextHourBoundary(now: number): number {
    return this.getHourStart(now) + MS_PER_HOUR;
  }

  /**
   * Gets the next day boundary (midnight UTC)
   */
  private getNextDayBoundary(now: number): number {
    return this.getDayStart(now) + MS_PER_DAY;
  }
}

/**
 * Creates a new WithdrawalRateLimiter with the given configuration
 *
 * @param config - Rate limit configuration
 * @returns A configured WithdrawalRateLimiter instance
 */
export function createRateLimiter(config?: Partial<RateLimitConfig>): WithdrawalRateLimiter {
  return new WithdrawalRateLimiter(config);
}

/**
 * Pre-configured rate limiter for conservative limits (amounts in zatoshis)
 */
export function createConservativeRateLimiter(): WithdrawalRateLimiter {
  return new WithdrawalRateLimiter({
    maxWithdrawalsPerHour: 3,
    maxWithdrawalsPerDay: 10,
    maxAmountPerWithdrawal: 10_00000000n, // 10 ZEC
    maxTotalAmountPerDay: 50_00000000n, // 50 ZEC
    cooldownMs: 300000, // 5 minutes
  });
}

/**
 * Pre-configured rate limiter for high-volume exchanges (amounts in zatoshis)
 */
export function createHighVolumeRateLimiter(): WithdrawalRateLimiter {
  return new WithdrawalRateLimiter({
    maxWithdrawalsPerHour: 100,
    maxWithdrawalsPerDay: 500,
    maxAmountPerWithdrawal: 1000_00000000n, // 1000 ZEC
    maxTotalAmountPerDay: 10000_00000000n, // 10000 ZEC
    cooldownMs: 10000, // 10 seconds
  });
}
