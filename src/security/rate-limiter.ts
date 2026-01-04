/**
 * Rate Limiter Module
 *
 * Provides rate limiting for withdrawal operations to prevent abuse
 * and ensure compliance with exchange policies.
 *
 * @packageDocumentation
 */

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum withdrawals per hour per user */
  maxWithdrawalsPerHour: number;
  /** Maximum withdrawals per day per user */
  maxWithdrawalsPerDay: number;
  /** Maximum amount per single withdrawal (in ZEC) */
  maxAmountPerWithdrawal: number;
  /** Maximum total amount per day per user (in ZEC) */
  maxTotalAmountPerDay: number;
  /** Minimum cooldown between withdrawals in milliseconds */
  cooldownMs: number;
  /** Whether to enable sliding window rate limiting */
  useSlidingWindow?: boolean;
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
 */
export interface RateLimitUsage {
  /** Withdrawals in the current hour */
  withdrawalsThisHour: number;
  /** Withdrawals in the current day */
  withdrawalsThisDay: number;
  /** Total amount withdrawn today (in ZEC) */
  totalAmountToday: number;
  /** Timestamp of last withdrawal */
  lastWithdrawalAt?: number;
}

/**
 * Remaining limits for a user
 */
export interface RemainingLimit {
  /** Remaining withdrawals this hour */
  withdrawalsRemainingHour: number;
  /** Remaining withdrawals this day */
  withdrawalsRemainingDay: number;
  /** Remaining amount for single withdrawal (in ZEC) */
  maxSingleWithdrawal: number;
  /** Remaining total amount for today (in ZEC) */
  amountRemainingToday: number;
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
  /** Withdrawal amount in ZEC */
  amount: number;
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
 * Default rate limit configuration
 */
const DEFAULT_CONFIG: RateLimitConfig = {
  maxWithdrawalsPerHour: 10,
  maxWithdrawalsPerDay: 50,
  maxAmountPerWithdrawal: 100, // 100 ZEC
  maxTotalAmountPerDay: 1000, // 1000 ZEC
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

  /** Per-user rate limit state */
  private readonly userStates: Map<string, UserRateLimitState>;

  /** Function to get current timestamp (for testing) */
  private readonly getNow: () => number;

  /**
   * Creates a new WithdrawalRateLimiter
   *
   * @param config - Rate limit configuration
   * @param getNow - Optional function to get current time (for testing)
   */
  constructor(config: Partial<RateLimitConfig> = {}, getNow?: () => number) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.userStates = new Map();
    this.getNow = getNow ?? (() => Date.now());

    // Validate configuration
    this.validateConfig();
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
    if (this.config.maxAmountPerWithdrawal <= 0) {
      throw new Error('maxAmountPerWithdrawal must be positive');
    }
    if (this.config.maxTotalAmountPerDay <= 0) {
      throw new Error('maxTotalAmountPerDay must be positive');
    }
    if (this.config.cooldownMs < 0) {
      throw new Error('cooldownMs cannot be negative');
    }
  }

  /**
   * Checks if a withdrawal is allowed for a user
   *
   * @param userId - The user identifier
   * @param amount - The withdrawal amount in ZEC
   * @returns Rate limit check result
   */
  checkLimit(userId: string, amount: number): RateLimitResult {
    const now = this.getNow();
    const state = this.getOrCreateUserState(userId);

    // Clean up old records
    this.cleanupOldRecords(state, now);

    // Calculate current usage
    const usage = this.calculateUsage(state, now);

    // Check cooldown
    if (state.lastWithdrawalAt !== undefined) {
      const timeSinceLastWithdrawal = now - state.lastWithdrawalAt;
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
    if (amount > this.config.maxAmountPerWithdrawal) {
      return {
        allowed: false,
        reason: `Amount ${amount} ZEC exceeds maximum single withdrawal of ${this.config.maxAmountPerWithdrawal} ZEC`,
        usage,
      };
    }

    // Check daily total amount
    const projectedTotalToday = usage.totalAmountToday + amount;
    if (projectedTotalToday > this.config.maxTotalAmountPerDay) {
      const remaining = this.config.maxTotalAmountPerDay - usage.totalAmountToday;
      return {
        allowed: false,
        reason: `Daily amount limit exceeded. Maximum remaining: ${remaining.toFixed(8)} ZEC`,
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
   * Records a successful withdrawal
   *
   * @param userId - The user identifier
   * @param amount - The withdrawal amount in ZEC
   */
  recordWithdrawal(userId: string, amount: number): void {
    const now = this.getNow();
    const state = this.getOrCreateUserState(userId);

    // Clean up old records first
    this.cleanupOldRecords(state, now);

    // Add new withdrawal record
    state.withdrawals.push({
      amount,
      timestamp: now,
    });

    state.lastWithdrawalAt = now;
  }

  /**
   * Gets the remaining limits for a user
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

    // Calculate cooldown remaining
    let cooldownRemainingMs = 0;
    if (state.lastWithdrawalAt !== undefined) {
      const timeSinceLastWithdrawal = now - state.lastWithdrawalAt;
      if (timeSinceLastWithdrawal < this.config.cooldownMs) {
        cooldownRemainingMs = this.config.cooldownMs - timeSinceLastWithdrawal;
      }
    }

    // Calculate reset times
    const hourResetAt = this.getNextHourBoundary(now);
    const dayResetAt = this.getNextDayBoundary(now);

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
      amountRemainingToday: Math.max(
        0,
        this.config.maxTotalAmountPerDay - usage.totalAmountToday
      ),
      cooldownRemainingMs,
      hourResetAt,
      dayResetAt,
    };
  }

  /**
   * Resets the rate limit state for a user
   *
   * @param userId - The user identifier
   */
  resetUser(userId: string): void {
    this.userStates.delete(userId);
  }

  /**
   * Resets all rate limit state
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
    let totalAmountToday = 0;

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
 * Pre-configured rate limiter for conservative limits
 */
export function createConservativeRateLimiter(): WithdrawalRateLimiter {
  return new WithdrawalRateLimiter({
    maxWithdrawalsPerHour: 3,
    maxWithdrawalsPerDay: 10,
    maxAmountPerWithdrawal: 10,
    maxTotalAmountPerDay: 50,
    cooldownMs: 300000, // 5 minutes
  });
}

/**
 * Pre-configured rate limiter for high-volume exchanges
 */
export function createHighVolumeRateLimiter(): WithdrawalRateLimiter {
  return new WithdrawalRateLimiter({
    maxWithdrawalsPerHour: 100,
    maxWithdrawalsPerDay: 500,
    maxAmountPerWithdrawal: 1000,
    maxTotalAmountPerDay: 10000,
    cooldownMs: 10000, // 10 seconds
  });
}
