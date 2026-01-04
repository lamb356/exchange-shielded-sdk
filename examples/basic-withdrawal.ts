/**
 * Basic Withdrawal Example
 *
 * This example demonstrates how to:
 * - Connect to zcashd
 * - Validate destination address
 * - Estimate fee
 * - Process withdrawal
 * - Wait for confirmation
 *
 * Run with: npx ts-node examples/basic-withdrawal.ts
 */

import {
  createExchangeSDK,
  validateAddressDetailed,
  isShielded,
  SDKConfig,
  WithdrawalRequest,
  WithdrawalResult,
} from '../src/index.js';

// Configuration - replace with your actual values
const config: SDKConfig = {
  rpc: {
    host: process.env.ZCASH_RPC_HOST || '127.0.0.1',
    port: parseInt(process.env.ZCASH_RPC_PORT || '8232'),
    auth: {
      username: process.env.ZCASH_RPC_USER || 'rpcuser',
      password: process.env.ZCASH_RPC_PASSWORD || 'rpcpassword',
    },
    timeout: 30000,
  },
  enableCompliance: true,
  enableAuditLogging: true,
  minconf: 10,
  privacyPolicy: 'FullPrivacy',
  rateLimiter: {
    maxWithdrawalsPerHour: 10,
    maxWithdrawalsPerDay: 50,
    maxAmountPerWithdrawal: 100,
    maxTotalAmountPerDay: 1000,
    cooldownMs: 60000,
  },
};

// Example addresses - replace with real addresses for production
const HOT_WALLET_ADDRESS = 'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly';
const DESTINATION_ADDRESS = 'zs1gv64eu0v2wx7raxqxlmj354y9ycznwaau9kduljzczxztvs4qcl00kn2sjxtejvrxnkucw5xx9u';

async function main(): Promise<void> {
  console.log('=== Exchange Shielded SDK - Basic Withdrawal Example ===\n');

  // Step 1: Initialize the SDK
  console.log('Step 1: Initializing SDK...');
  const sdk = createExchangeSDK(config);
  console.log('SDK initialized successfully.\n');

  // Step 2: Validate the destination address
  console.log('Step 2: Validating destination address...');
  const addressValidation = validateAddressDetailed(DESTINATION_ADDRESS);

  console.log(`  Address: ${DESTINATION_ADDRESS.substring(0, 20)}...`);
  console.log(`  Valid: ${addressValidation.valid}`);
  console.log(`  Type: ${addressValidation.type}`);
  console.log(`  Shielded: ${addressValidation.shielded}`);
  console.log(`  Network: ${addressValidation.network}`);

  if (!addressValidation.valid) {
    console.error(`\nError: Invalid address - ${addressValidation.error}`);
    process.exit(1);
  }

  // Check if destination supports memos
  const supportsMemo = isShielded(DESTINATION_ADDRESS);
  console.log(`  Supports Memo: ${supportsMemo}\n`);

  // Step 3: Estimate the withdrawal fee
  console.log('Step 3: Estimating withdrawal fee...');
  const amount = 1.5; // ZEC

  try {
    const feeEstimate = await sdk.estimateWithdrawalFee(amount, DESTINATION_ADDRESS);

    console.log(`  Amount to send: ${amount} ZEC`);
    console.log(`  Estimated fee: ${feeEstimate.feeZec} ZEC (${feeEstimate.feeZatoshis} zatoshis)`);
    console.log(`  Logical actions: ${feeEstimate.logicalActions}`);
    console.log(`  Total required: ${amount + feeEstimate.feeZec} ZEC`);
    console.log(`  Note: Estimate is ${feeEstimate.isApproximate ? 'approximate' : 'exact'}\n`);
  } catch (error) {
    console.log(`  Using default fee estimate (actual fee calculated by zcashd)\n`);
  }

  // Step 4: Check rate limits before processing
  console.log('Step 4: Checking rate limits...');
  const userId = 'user-123';
  const rateLimitCheck = sdk.checkRateLimit(userId, amount);

  console.log(`  User: ${userId}`);
  console.log(`  Amount: ${amount} ZEC`);
  console.log(`  Allowed: ${rateLimitCheck.allowed}`);

  if (!rateLimitCheck.allowed) {
    console.log(`  Reason: ${rateLimitCheck.reason}`);
    if (rateLimitCheck.retryAfterMs) {
      console.log(`  Retry after: ${Math.ceil(rateLimitCheck.retryAfterMs / 1000)} seconds`);
    }
    console.log('\nWithdrawal blocked by rate limiter.');
    process.exit(1);
  }

  console.log(`  Current usage:`);
  console.log(`    - Withdrawals this hour: ${rateLimitCheck.usage.withdrawalsThisHour}`);
  console.log(`    - Withdrawals today: ${rateLimitCheck.usage.withdrawalsThisDay}`);
  console.log(`    - Amount today: ${rateLimitCheck.usage.totalAmountToday} ZEC\n`);

  // Step 5: Check velocity (compliance check)
  console.log('Step 5: Checking velocity (compliance)...');
  const velocityCheck = sdk.checkVelocity(userId, amount);

  console.log(`  Passed: ${velocityCheck.passed}`);
  console.log(`  Risk score: ${velocityCheck.riskScore}/100`);

  if (!velocityCheck.passed) {
    console.log(`  Reason: ${velocityCheck.reason}`);
    console.log('\nWithdrawal blocked by velocity check.');
    process.exit(1);
  }
  console.log('');

  // Step 6: Process the withdrawal
  console.log('Step 6: Processing withdrawal...');
  console.log('  (This would submit to zcashd in production)\n');

  const withdrawalRequest: WithdrawalRequest = {
    userId,
    fromAddress: HOT_WALLET_ADDRESS,
    toAddress: DESTINATION_ADDRESS,
    amount,
    memo: supportsMemo ? '48656c6c6f20576f726c6421' : undefined, // "Hello World!" in hex
    requestId: `demo-${Date.now()}`,
  };

  console.log('  Withdrawal Request:');
  console.log(`    - User ID: ${withdrawalRequest.userId}`);
  console.log(`    - From: ${withdrawalRequest.fromAddress.substring(0, 20)}...`);
  console.log(`    - To: ${withdrawalRequest.toAddress.substring(0, 20)}...`);
  console.log(`    - Amount: ${withdrawalRequest.amount} ZEC`);
  console.log(`    - Memo: ${withdrawalRequest.memo ? 'Included' : 'None'}`);
  console.log(`    - Request ID: ${withdrawalRequest.requestId}`);

  // In production, you would call:
  // const result = await sdk.processWithdrawal(withdrawalRequest);

  // For this demo, we'll simulate a successful result
  const simulatedResult: WithdrawalResult = {
    success: true,
    transactionId: 'abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234',
    operationId: 'opid-demo-123',
    fee: 0.0001,
    requestId: withdrawalRequest.requestId,
    completedAt: new Date(),
  };

  console.log('\n  Result:');
  console.log(`    - Success: ${simulatedResult.success}`);
  console.log(`    - Transaction ID: ${simulatedResult.transactionId}`);
  console.log(`    - Operation ID: ${simulatedResult.operationId}`);
  console.log(`    - Fee paid: ${simulatedResult.fee} ZEC`);
  console.log(`    - Completed at: ${simulatedResult.completedAt}`);

  // Step 7: Verify transaction status
  console.log('\nStep 7: Checking transaction status...');

  // In production, you would call:
  // const status = await sdk.getWithdrawalStatus(simulatedResult.transactionId);

  console.log('  Status: completed');
  console.log('  Confirmations: 0 (just submitted)');
  console.log('  Note: Wait for 10+ confirmations for finality.\n');

  // Summary
  console.log('=== Withdrawal Summary ===');
  console.log(`  Amount sent: ${amount} ZEC`);
  console.log(`  Fee paid: ${simulatedResult.fee} ZEC`);
  console.log(`  Total: ${amount + (simulatedResult.fee || 0)} ZEC`);
  console.log(`  Transaction: ${simulatedResult.transactionId?.substring(0, 16)}...`);
  console.log('\nWithdrawal completed successfully!');
}

// Run the example
main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
