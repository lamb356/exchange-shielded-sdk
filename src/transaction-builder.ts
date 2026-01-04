/**
 * Shielded Transaction Builder Module
 *
 * Provides functionality for building shielded withdrawal transactions
 * with ZIP 317 compliant fee estimation.
 *
 * @packageDocumentation
 */

import { validateAddress, isShielded, AddressType } from './address-validator.js';

/**
 * ZIP 317 fee constants
 * @see https://zips.z.cash/zip-0317
 */
export const ZIP317 = {
  /** Marginal fee per logical action in zatoshis */
  MARGINAL_FEE: 5000,
  /** Grace period - minimum logical actions charged */
  GRACE_ACTIONS: 2,
  /** Standard P2PKH input size in bytes */
  P2PKH_INPUT_SIZE: 150,
  /** Standard P2PKH output size in bytes */
  P2PKH_OUTPUT_SIZE: 34,
  /** Minimum fee (grace_actions * marginal_fee) in zatoshis */
  MINIMUM_FEE: 10000,
  /** Zatoshis per ZEC */
  ZATOSHIS_PER_ZEC: 100_000_000,
} as const;

/**
 * Transaction input for an unsigned transaction
 */
export interface TransactionInput {
  /** Transaction ID of the UTXO */
  txid: string;
  /** Output index in the transaction */
  vout: number;
  /** Value in zatoshis */
  value: number;
  /** Address that owns this input */
  address: string;
  /** Pool type for shielded inputs */
  pool?: 'transparent' | 'sprout' | 'sapling' | 'orchard';
}

/**
 * Transaction output for an unsigned transaction
 */
export interface TransactionOutput {
  /** Destination address */
  address: string;
  /** Value in zatoshis */
  value: number;
  /** Optional memo (hex-encoded, for shielded outputs only) */
  memo?: string;
  /** Pool type for shielded outputs */
  pool?: 'transparent' | 'sprout' | 'sapling' | 'orchard';
}

/**
 * A pending transaction that has not yet been submitted
 */
export interface PendingTransaction {
  /** Source address for the withdrawal */
  from: string;
  /** Destination address */
  to: string;
  /** Amount in ZEC (not zatoshis) */
  amount: number;
  /** Optional memo (for shielded recipients only) */
  memo?: string;
  /** Estimated fee in ZEC (calculated if not provided) */
  fee?: number;
  /** Timestamp when the transaction was created */
  createdAt: number;
  /** Source address type */
  fromType: AddressType;
  /** Destination address type */
  toType: AddressType;
}

/**
 * An unsigned transaction ready for signing/submission
 */
export interface UnsignedTransaction {
  /** Raw transaction hex (placeholder for future use) */
  raw: string;
  /** Transaction inputs */
  inputs: TransactionInput[];
  /** Transaction outputs */
  outputs: TransactionOutput[];
  /** Fee in zatoshis */
  fee: number;
  /** Estimated number of logical actions */
  logicalActions: number;
}

/**
 * Amount entry for z_sendmany RPC call
 */
export interface ZAmount {
  /** Destination address */
  address: string;
  /** Amount in ZEC */
  amount: number;
  /** Optional hex-encoded memo (512 bytes max) */
  memo?: string;
}

/**
 * Privacy policy for z_sendmany
 * @see https://zcash.github.io/rpc/z_sendmany.html
 */
export type PrivacyPolicy =
  | 'FullPrivacy'
  | 'LegacyCompat'
  | 'AllowRevealedAmounts'
  | 'AllowRevealedRecipients'
  | 'AllowRevealedSenders'
  | 'AllowFullyTransparent'
  | 'AllowLinkingAccountAddresses'
  | 'NoPrivacy';

/**
 * Request object for z_sendmany RPC call
 */
export interface ZSendmanyRequest {
  /** Source address or 'ANY_TADDR' */
  fromaddress: string;
  /** Array of recipient amounts */
  amounts: ZAmount[];
  /** Minimum confirmations required for inputs */
  minconf: number;
  /** Fee in ZEC (null for ZIP 317 default) */
  fee: number | null;
  /** Privacy policy */
  privacyPolicy: PrivacyPolicy;
}

/**
 * Options for fee estimation
 */
export interface FeeEstimateOptions {
  /** Number of transparent inputs */
  transparentInputs?: number;
  /** Number of transparent outputs */
  transparentOutputs?: number;
  /** Number of Sapling spends */
  saplingSpends?: number;
  /** Number of Sapling outputs */
  saplingOutputs?: number;
  /** Number of Orchard actions */
  orchardActions?: number;
  /** Include memo in calculation (adds to output count) */
  hasMemo?: boolean;
}

/**
 * Fee estimation result
 */
export interface FeeEstimate {
  /** Fee in zatoshis */
  zatoshis: number;
  /** Fee in ZEC */
  zec: number;
  /** Number of logical actions calculated */
  logicalActions: number;
  /** Breakdown of actions by type */
  breakdown: {
    transparent: number;
    sapling: number;
    orchard: number;
  };
}

/**
 * Error thrown when transaction building fails
 */
export class TransactionBuilderError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'TransactionBuilderError';
  }
}

/**
 * Calculates the number of logical actions for transparent components
 * Based on ZIP 317 formula: max(ceil(input_bytes/150), ceil(output_bytes/34))
 *
 * @param inputCount - Number of transparent inputs
 * @param outputCount - Number of transparent outputs
 * @returns Number of logical actions for transparent component
 */
export function calculateTransparentActions(inputCount: number, outputCount: number): number {
  if (inputCount === 0 && outputCount === 0) {
    return 0;
  }

  const inputBytes = inputCount * ZIP317.P2PKH_INPUT_SIZE;
  const outputBytes = outputCount * ZIP317.P2PKH_OUTPUT_SIZE;

  const inputActions = Math.ceil(inputBytes / ZIP317.P2PKH_INPUT_SIZE);
  const outputActions = Math.ceil(outputBytes / ZIP317.P2PKH_OUTPUT_SIZE);

  return Math.max(inputActions, outputActions);
}

/**
 * Calculates the number of logical actions for Sapling components
 * Based on ZIP 317: max(spends, outputs)
 *
 * @param spends - Number of Sapling spends
 * @param outputs - Number of Sapling outputs
 * @returns Number of logical actions for Sapling component
 */
export function calculateSaplingActions(spends: number, outputs: number): number {
  return Math.max(spends, outputs);
}

/**
 * Calculates the number of logical actions for Orchard components
 * Orchard actions are counted directly (each action is one logical action)
 *
 * @param actions - Number of Orchard actions
 * @returns Number of logical actions for Orchard component
 */
export function calculateOrchardActions(actions: number): number {
  return actions;
}

/**
 * Calculates the total number of logical actions for a transaction
 *
 * @param options - Fee estimation options with component counts
 * @returns Total number of logical actions
 */
export function calculateLogicalActions(options: FeeEstimateOptions): number {
  const transparentInputs = options.transparentInputs ?? 0;
  const transparentOutputs = options.transparentOutputs ?? 0;
  const saplingSpends = options.saplingSpends ?? 0;
  const saplingOutputs = options.saplingOutputs ?? 0;
  const orchardActions = options.orchardActions ?? 0;

  const transparentActions = calculateTransparentActions(transparentInputs, transparentOutputs);
  const saplingActions = calculateSaplingActions(saplingSpends, saplingOutputs);
  const orchardActionsTotal = calculateOrchardActions(orchardActions);

  return transparentActions + saplingActions + orchardActionsTotal;
}

/**
 * Calculates the conventional fee based on ZIP 317
 * Formula: marginal_fee * max(grace_actions, logical_actions)
 *
 * @param logicalActions - Number of logical actions
 * @returns Fee in zatoshis
 */
export function calculateConventionalFee(logicalActions: number): number {
  const effectiveActions = Math.max(ZIP317.GRACE_ACTIONS, logicalActions);
  return ZIP317.MARGINAL_FEE * effectiveActions;
}

/**
 * Estimates the fee for a transaction based on its components
 *
 * @param options - Fee estimation options
 * @returns Detailed fee estimate
 */
export function estimateTransactionFee(options: FeeEstimateOptions): FeeEstimate {
  const transparentInputs = options.transparentInputs ?? 0;
  const transparentOutputs = options.transparentOutputs ?? 0;
  const saplingSpends = options.saplingSpends ?? 0;
  const saplingOutputs = options.saplingOutputs ?? 0;
  const orchardActions = options.orchardActions ?? 0;

  const transparentActions = calculateTransparentActions(transparentInputs, transparentOutputs);
  const saplingActions = calculateSaplingActions(saplingSpends, saplingOutputs);
  const orchardActionsTotal = calculateOrchardActions(orchardActions);

  const totalLogicalActions = transparentActions + saplingActions + orchardActionsTotal;
  const feeZatoshis = calculateConventionalFee(totalLogicalActions);

  return {
    zatoshis: feeZatoshis,
    zec: feeZatoshis / ZIP317.ZATOSHIS_PER_ZEC,
    logicalActions: totalLogicalActions,
    breakdown: {
      transparent: transparentActions,
      sapling: saplingActions,
      orchard: orchardActionsTotal,
    },
  };
}

/**
 * Shielded Transaction Builder
 *
 * Builds transactions for shielded withdrawals with proper fee estimation
 * and z_sendmany request preparation.
 */
export class ShieldedTransactionBuilder {
  /** Default minimum confirmations for inputs */
  private readonly defaultMinconf: number;

  /** Default privacy policy */
  private readonly defaultPrivacyPolicy: PrivacyPolicy;

  /**
   * Creates a new ShieldedTransactionBuilder
   *
   * @param options - Builder options
   * @param options.minconf - Default minimum confirmations (default: 10)
   * @param options.privacyPolicy - Default privacy policy (default: 'FullPrivacy')
   */
  constructor(options?: { minconf?: number; privacyPolicy?: PrivacyPolicy }) {
    this.defaultMinconf = options?.minconf ?? 10;
    this.defaultPrivacyPolicy = options?.privacyPolicy ?? 'FullPrivacy';
  }

  /**
   * Builds a pending shielded withdrawal transaction
   *
   * @param from - Source address (must be shielded: zs, zc, or u1)
   * @param to - Destination address (any valid Zcash address)
   * @param amount - Amount in ZEC to withdraw
   * @param memo - Optional memo (hex-encoded, for shielded recipients only)
   * @returns A pending transaction ready for fee estimation and submission
   * @throws TransactionBuilderError if addresses are invalid
   */
  buildShieldedWithdrawal(
    from: string,
    to: string,
    amount: number,
    memo?: string
  ): PendingTransaction {
    // Validate source address
    const fromType = validateAddress(from);
    if (fromType === 'unknown') {
      throw new TransactionBuilderError(`Invalid source address: ${from}`, 'INVALID_FROM_ADDRESS');
    }

    // Source must be shielded for a shielded withdrawal
    if (!isShielded(from)) {
      throw new TransactionBuilderError(
        'Source address must be shielded (zs, zc, or u1 prefix)',
        'NOT_SHIELDED_SOURCE'
      );
    }

    // Validate destination address
    const toType = validateAddress(to);
    if (toType === 'unknown') {
      throw new TransactionBuilderError(
        `Invalid destination address: ${to}`,
        'INVALID_TO_ADDRESS'
      );
    }

    // Validate amount
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      throw new TransactionBuilderError(
        'Amount must be a positive number',
        'INVALID_AMOUNT'
      );
    }

    // Validate memo is only provided for shielded recipients
    if (memo && !isShielded(to)) {
      throw new TransactionBuilderError(
        'Memo can only be provided for shielded recipients',
        'MEMO_NOT_ALLOWED'
      );
    }

    // Validate memo format (should be hex-encoded if provided)
    if (memo && !/^[0-9a-fA-F]*$/.test(memo)) {
      throw new TransactionBuilderError(
        'Memo must be hex-encoded',
        'INVALID_MEMO_FORMAT'
      );
    }

    // Validate memo length (max 512 bytes = 1024 hex characters)
    if (memo && memo.length > 1024) {
      throw new TransactionBuilderError(
        'Memo exceeds maximum length of 512 bytes',
        'MEMO_TOO_LONG'
      );
    }

    return {
      from,
      to,
      amount,
      memo,
      createdAt: Date.now(),
      fromType,
      toType,
    };
  }

  /**
   * Estimates the fee for a pending transaction
   *
   * This is a simplified estimation that assumes:
   * - 1 input from the source (Sapling or Orchard based on address type)
   * - 1 output to the destination
   * - Change output if needed (not currently modeled)
   *
   * For accurate fee estimation, use z_sendmany with fee: null
   * to let zcashd calculate the proper ZIP 317 fee.
   *
   * @param transaction - The pending transaction
   * @returns Promise resolving to estimated fee in ZEC
   */
  async estimateFee(transaction: PendingTransaction): Promise<number> {
    const options: FeeEstimateOptions = {
      transparentInputs: 0,
      transparentOutputs: 0,
      saplingSpends: 0,
      saplingOutputs: 0,
      orchardActions: 0,
      hasMemo: !!transaction.memo,
    };

    // Determine input type based on source address
    if (transaction.fromType === 'unified' || transaction.fromType === 'orchard') {
      // Unified addresses typically use Orchard
      options.orchardActions = 1;
    } else if (transaction.fromType === 'sapling') {
      options.saplingSpends = 1;
    } else if (transaction.fromType === 'sprout') {
      // Sprout uses JoinSplits, which count as 2 actions each
      // For simplicity, we model this as 2 Sapling spends
      options.saplingSpends = 2;
    }

    // Determine output type based on destination address
    if (transaction.toType === 'transparent') {
      options.transparentOutputs = 1;
    } else if (transaction.toType === 'unified' || transaction.toType === 'orchard') {
      // Add to Orchard actions
      options.orchardActions = (options.orchardActions ?? 0) + 1;
    } else if (transaction.toType === 'sapling') {
      options.saplingOutputs = 1;
    } else if (transaction.toType === 'sprout') {
      options.saplingOutputs = 2;
    }

    // Add change output (typically same pool as source)
    if (transaction.fromType === 'unified' || transaction.fromType === 'orchard') {
      options.orchardActions = (options.orchardActions ?? 0) + 1;
    } else if (transaction.fromType === 'sapling') {
      options.saplingOutputs = (options.saplingOutputs ?? 0) + 1;
    }

    const estimate = estimateTransactionFee(options);
    return estimate.zec;
  }

  /**
   * Prepares a z_sendmany RPC request from a pending transaction
   *
   * @param tx - The pending transaction
   * @param options - Optional overrides
   * @param options.minconf - Minimum confirmations (default: builder default)
   * @param options.fee - Fee in ZEC (null for ZIP 317 default)
   * @param options.privacyPolicy - Privacy policy (default: builder default)
   * @returns A ZSendmanyRequest ready for RPC submission
   */
  prepareZSendmany(
    tx: PendingTransaction,
    options?: {
      minconf?: number;
      fee?: number | null;
      privacyPolicy?: PrivacyPolicy;
    }
  ): ZSendmanyRequest {
    const amount: ZAmount = {
      address: tx.to,
      amount: tx.amount,
    };

    // Only include memo for shielded recipients
    if (tx.memo && isShielded(tx.to)) {
      amount.memo = tx.memo;
    }

    return {
      fromaddress: tx.from,
      amounts: [amount],
      minconf: options?.minconf ?? this.defaultMinconf,
      fee: options?.fee ?? tx.fee ?? null,
      privacyPolicy: options?.privacyPolicy ?? this.defaultPrivacyPolicy,
    };
  }

  /**
   * Validates that a transaction can be built with the given parameters
   *
   * @param from - Source address
   * @param to - Destination address
   * @param amount - Amount in ZEC
   * @returns Object with validation result and any error messages
   */
  validateTransaction(
    from: string,
    to: string,
    amount: number
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const fromType = validateAddress(from);
    if (fromType === 'unknown') {
      errors.push('Invalid source address');
    } else if (!isShielded(from)) {
      errors.push('Source address must be shielded');
    }

    const toType = validateAddress(to);
    if (toType === 'unknown') {
      errors.push('Invalid destination address');
    }

    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      errors.push('Amount must be a positive number');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
