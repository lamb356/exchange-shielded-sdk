/**
 * Rate Limiting Example
 *
 * This example demonstrates how to:
 * - Configure limits
 * - Handle rate limit exceeded
 * - Check remaining limits
 *
 * Run with: npx ts-node examples/rate-limiting.ts
 */

import {
  WithdrawalRateLimiter,
  createRateLimiter,
  createConservativeRateLimiter,
  createHighVolumeRateLimiter,
  RateLimitConfig,
  RateLimitResult,
} from '../src/index.js';

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.ceil(ms / 1000)}s`;
  return `${Math.ceil(ms / 60000)}m`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

async function main(): Promise<void> {
  console.log('=== Exchange Shielded SDK - Rate Limiting Example ===\n');

  // =========================================================================
  // Part 1: Basic Configuration
  // =========================================================================
  console.log('Part 1: Basic Rate Limiter Configuration\n');

  // Custom configuration
  const customConfig: Partial<RateLimitConfig> = {
    maxWithdrawalsPerHour: 5,
    maxWithdrawalsPerDay: 20,
    maxAmountPerWithdrawal: 50,      // 50 ZEC max per withdrawal
    maxTotalAmountPerDay: 200,       // 200 ZEC max per day
    cooldownMs: 30000,                // 30 seconds between withdrawals
    useSlidingWindow: true,
  };

  const limiter = createRateLimiter(customConfig);
  const config = limiter.getConfig();

  console.log('Custom rate limiter created:');
  console.log(`  Max withdrawals/hour: ${config.maxWithdrawalsPerHour}`);
  console.log(`  Max withdrawals/day: ${config.maxWithdrawalsPerDay}`);
  console.log(`  Max amount/withdrawal: ${config.maxAmountPerWithdrawal} ZEC`);
  console.log(`  Max amount/day: ${config.maxTotalAmountPerDay} ZEC`);
  console.log(`  Cooldown: ${formatTime(config.cooldownMs)}`);
  console.log(`  Sliding window: ${config.useSlidingWindow}\n`);

  // =========================================================================
  // Part 2: Pre-configured Limiters
  // =========================================================================
  console.log('Part 2: Pre-configured Limiters\n');

  const conservative = createConservativeRateLimiter();
  const conservativeConfig = conservative.getConfig();
  console.log('Conservative limiter (high security):');
  console.log(`  Max withdrawals/hour: ${conservativeConfig.maxWithdrawalsPerHour}`);
  console.log(`  Max withdrawals/day: ${conservativeConfig.maxWithdrawalsPerDay}`);
  console.log(`  Max amount/withdrawal: ${conservativeConfig.maxAmountPerWithdrawal} ZEC`);
  console.log(`  Cooldown: ${formatTime(conservativeConfig.cooldownMs)}\n`);

  const highVolume = createHighVolumeRateLimiter();
  const highVolumeConfig = highVolume.getConfig();
  console.log('High-volume limiter (busy exchanges):');
  console.log(`  Max withdrawals/hour: ${highVolumeConfig.maxWithdrawalsPerHour}`);
  console.log(`  Max withdrawals/day: ${highVolumeConfig.maxWithdrawalsPerDay}`);
  console.log(`  Max amount/withdrawal: ${highVolumeConfig.maxAmountPerWithdrawal} ZEC`);
  console.log(`  Cooldown: ${formatTime(highVolumeConfig.cooldownMs)}\n`);

  // =========================================================================
  // Part 3: Checking Limits
  // =========================================================================
  console.log('Part 3: Checking Rate Limits\n');

  const userId = 'user-123';

  // Check if withdrawal is allowed
  console.log(`Checking if ${userId} can withdraw 10 ZEC...`);
  let check = limiter.checkLimit(userId, 10);

  console.log(`  Allowed: ${check.allowed}`);
  console.log('  Current usage:');
  console.log(`    Withdrawals this hour: ${check.usage.withdrawalsThisHour}`);
  console.log(`    Withdrawals today: ${check.usage.withdrawalsThisDay}`);
  console.log(`    Amount today: ${check.usage.totalAmountToday} ZEC`);
  console.log('');

  // =========================================================================
  // Part 4: Recording Withdrawals
  // =========================================================================
  console.log('Part 4: Recording Withdrawals\n');

  // Process some withdrawals
  const withdrawals = [10, 15, 20, 25, 5];

  for (const amount of withdrawals) {
    check = limiter.checkLimit(userId, amount);

    if (check.allowed) {
      limiter.recordWithdrawal(userId, amount);
      console.log(`  Withdrawal of ${amount} ZEC - RECORDED`);
    } else {
      console.log(`  Withdrawal of ${amount} ZEC - DENIED: ${check.reason}`);
    }
  }
  console.log('');

  // =========================================================================
  // Part 5: Handling Rate Limit Exceeded
  // =========================================================================
  console.log('Part 5: Handling Rate Limit Exceeded\n');

  // Try to exceed hourly limit
  console.log('Attempting more withdrawals to trigger limits...\n');

  for (let i = 0; i < 3; i++) {
    check = limiter.checkLimit(userId, 10);

    if (!check.allowed) {
      console.log('Rate limit exceeded!');
      console.log(`  Reason: ${check.reason}`);

      if (check.retryAfterMs) {
        console.log(`  Retry after: ${formatTime(check.retryAfterMs)}`);
      }

      // Get remaining limits
      const remaining = limiter.getRemainingLimit(userId);
      console.log('\n  Remaining limits:');
      console.log(`    Withdrawals this hour: ${remaining.withdrawalsRemainingHour}`);
      console.log(`    Withdrawals today: ${remaining.withdrawalsRemainingDay}`);
      console.log(`    Amount remaining today: ${remaining.amountRemainingToday} ZEC`);
      console.log(`    Hour resets at: ${formatDate(remaining.hourResetAt)}`);
      console.log(`    Day resets at: ${formatDate(remaining.dayResetAt)}`);
      break;
    } else {
      limiter.recordWithdrawal(userId, 10);
      console.log(`  Withdrawal ${i + 1}: 10 ZEC - RECORDED`);
    }
  }
  console.log('');

  // =========================================================================
  // Part 6: Amount Limit
  // =========================================================================
  console.log('Part 6: Amount Limits\n');

  const newUser = 'user-456';

  // Try to withdraw more than max single amount
  console.log(`Attempting to withdraw 100 ZEC (max: ${config.maxAmountPerWithdrawal} ZEC)...`);
  check = limiter.checkLimit(newUser, 100);

  if (!check.allowed) {
    console.log(`  Denied: ${check.reason}`);
  }
  console.log('');

  // Multiple smaller withdrawals approaching daily limit
  console.log('Processing multiple withdrawals to approach daily limit...\n');

  const amounts = [40, 40, 40, 40, 40, 40];
  for (const amount of amounts) {
    check = limiter.checkLimit(newUser, amount);

    if (check.allowed) {
      limiter.recordWithdrawal(newUser, amount);
      const remaining = limiter.getRemainingLimit(newUser);
      console.log(`  ${amount} ZEC - OK (${remaining.amountRemainingToday} ZEC remaining today)`);
    } else {
      console.log(`  ${amount} ZEC - DENIED: ${check.reason}`);
      break;
    }
  }
  console.log('');

  // =========================================================================
  // Part 7: Cooldown Period
  // =========================================================================
  console.log('Part 7: Cooldown Period\n');

  // Create a limiter with shorter cooldown for demo
  const fastLimiter = new WithdrawalRateLimiter({
    maxWithdrawalsPerHour: 100,
    maxWithdrawalsPerDay: 1000,
    maxAmountPerWithdrawal: 1000,
    maxTotalAmountPerDay: 10000,
    cooldownMs: 5000,  // 5 seconds for demo
  });

  const cooldownUser = 'user-789';

  // First withdrawal
  check = fastLimiter.checkLimit(cooldownUser, 10);
  if (check.allowed) {
    fastLimiter.recordWithdrawal(cooldownUser, 10);
    console.log('First withdrawal: 10 ZEC - RECORDED');
  }

  // Immediate second attempt (should be blocked by cooldown)
  check = fastLimiter.checkLimit(cooldownUser, 10);
  if (!check.allowed && check.retryAfterMs) {
    console.log(`Second attempt: BLOCKED by cooldown`);
    console.log(`  Retry after: ${formatTime(check.retryAfterMs)}`);
  }

  // Wait for cooldown and retry
  console.log('\nWaiting for cooldown...');
  await new Promise((resolve) => setTimeout(resolve, 5500));

  check = fastLimiter.checkLimit(cooldownUser, 10);
  if (check.allowed) {
    fastLimiter.recordWithdrawal(cooldownUser, 10);
    console.log('After cooldown: 10 ZEC - RECORDED');
  }
  console.log('');

  // =========================================================================
  // Part 8: Admin Operations
  // =========================================================================
  console.log('Part 8: Admin Operations\n');

  // Reset a specific user
  console.log('Resetting rate limits for user-123...');
  limiter.resetUser('user-123');

  check = limiter.checkLimit('user-123', 10);
  console.log(`After reset - User can withdraw: ${check.allowed}`);
  console.log(`  Usage: ${check.usage.withdrawalsThisHour} this hour, ${check.usage.totalAmountToday} ZEC today\n`);

  // Reset all users
  console.log('Resetting all rate limits...');
  limiter.resetAll();
  console.log('All rate limits cleared.\n');

  // =========================================================================
  // Part 9: Best Practices
  // =========================================================================
  console.log('Part 9: Best Practices Summary\n');

  console.log('1. Always check limits BEFORE processing:');
  console.log('   const check = limiter.checkLimit(userId, amount);');
  console.log('   if (!check.allowed) return errorResponse(check.reason);\n');

  console.log('2. Record AFTER successful processing:');
  console.log('   const result = await processWithdrawal(...);');
  console.log('   if (result.success) limiter.recordWithdrawal(userId, amount);\n');

  console.log('3. Provide clear feedback to users:');
  console.log('   - Show remaining limits in UI');
  console.log('   - Include Retry-After header in 429 responses');
  console.log('   - Display when limits reset\n');

  console.log('4. Use tiered limits based on user verification:');
  console.log('   - Basic users: conservative limits');
  console.log('   - Verified users: standard limits');
  console.log('   - Institutional: high-volume limits\n');

  console.log('5. Monitor rate limit hits:');
  console.log('   - Log all denials for security review');
  console.log('   - Alert on unusual patterns');
  console.log('   - Consider temporary bans for abuse\n');

  console.log('=== Rate Limiting Example Complete ===');
}

// Run the example
main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
