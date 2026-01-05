/**
 * Data Transfer Objects for API/Storage Boundaries
 *
 * These types use strings for amounts to ensure JSON safety.
 * Always validate when converting from DTO to internal types.
 *
 * @packageDocumentation
 */

import { WithdrawalRequest, WithdrawalResult, WithdrawalStatus } from '../sdk/exchange-sdk.js';
import { Zatoshi, zatoshi, stringToZatoshi } from './money.js';

/**
 * External withdrawal request DTO
 * Used for API requests and storage
 */
export interface WithdrawalRequestDTO {
  userId: string;
  fromAddress: string;
  toAddress: string;
  /** Amount in zatoshis as string (JSON-safe) */
  amount: string;
  memo?: string;
  requestId?: string;
}

/**
 * External withdrawal result DTO
 * Used for API responses and storage
 */
export interface WithdrawalResultDTO {
  success: boolean;
  requestId?: string;
  transactionId?: string;
  operationId?: string;
  /** Amount in zatoshis as string (JSON-safe) */
  amount?: string;
  /** Fee in zatoshis as string (JSON-safe) */
  fee?: string;
  error?: string;
  errorCode?: string;
  completedAt?: string; // ISO date string
}

/**
 * External withdrawal status DTO
 */
export interface WithdrawalStatusDTO {
  requestId: string;
  status: string;
  txid?: string;
  confirmations?: number;
  blockHeight?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert internal WithdrawalResult to DTO for API response
 */
export function toWithdrawalResultDTO(result: WithdrawalResult): WithdrawalResultDTO {
  return {
    success: result.success,
    requestId: result.requestId,
    transactionId: result.transactionId,
    operationId: result.operationId,
    amount: result.amount !== undefined ? result.amount.toString() : undefined,
    fee: result.fee !== undefined ? result.fee.toString() : undefined,
    error: result.error,
    errorCode: result.errorCode,
    completedAt: result.completedAt?.toISOString(),
  };
}

/**
 * Convert DTO to internal WithdrawalRequest
 * Validates and parses the amount string
 */
export function fromWithdrawalRequestDTO(dto: WithdrawalRequestDTO): WithdrawalRequest {
  // Validate amount is a valid zatoshi string
  if (!/^\d+$/.test(dto.amount)) {
    throw new Error('Amount must be a non-negative integer string (zatoshis)');
  }

  return {
    userId: dto.userId,
    fromAddress: dto.fromAddress,
    toAddress: dto.toAddress,
    amount: stringToZatoshi(dto.amount),
    memo: dto.memo,
    requestId: dto.requestId,
  };
}

/**
 * Convert internal WithdrawalStatus to DTO
 */
export function toWithdrawalStatusDTO(status: WithdrawalStatus): WithdrawalStatusDTO {
  return {
    requestId: status.requestId,
    status: status.status,
    txid: status.txid,
    confirmations: status.confirmations,
    blockHeight: status.blockHeight,
    error: status.error,
    createdAt: status.createdAt.toISOString(),
    updatedAt: status.updatedAt.toISOString(),
  };
}
