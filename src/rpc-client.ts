/**
 * Zcash RPC Client Module
 *
 * Provides a typed interface for interacting with zcashd via JSON-RPC.
 * Implements the z_* methods needed for shielded transactions.
 *
 * @packageDocumentation
 */

import { ZAmount, PrivacyPolicy, ZSendmanyRequest } from './transaction-builder.js';

/**
 * RPC authentication credentials
 */
export interface RpcAuth {
  /** RPC username */
  username: string;
  /** RPC password */
  password: string;
}

/**
 * RPC connection configuration
 */
export interface RpcConfig {
  /** Host address (default: '127.0.0.1') */
  host: string;
  /** Port number (default: 8232 for mainnet, 18232 for testnet) */
  port: number;
  /** Authentication credentials */
  auth: RpcAuth;
  /** Connection timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Use HTTPS (default: false) */
  https?: boolean;
}

/**
 * JSON-RPC request structure
 */
export interface JsonRpcRequest {
  jsonrpc: '1.0' | '2.0';
  id: string | number;
  method: string;
  params: unknown[];
}

/**
 * JSON-RPC response structure
 */
export interface JsonRpcResponse<T = unknown> {
  result: T | null;
  error: JsonRpcError | null;
  id: string | number;
}

/**
 * JSON-RPC error structure
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Unspent shielded note from z_listunspent
 */
export interface UnspentNote {
  /** Transaction ID */
  txid: string;
  /** Value pool: 'sprout', 'sapling', or 'orchard' */
  pool: 'sprout' | 'sapling' | 'orchard';
  /** JoinSplit index (sprout only) */
  jsindex?: number;
  /** JoinSplit output index (sprout only) */
  jsoutindex?: number;
  /** Output or action index (sapling/orchard) */
  outindex?: number;
  /** Number of confirmations */
  confirmations: number;
  /** Whether the note is spendable */
  spendable: boolean;
  /** Unified account ID if applicable */
  account?: number;
  /** Shielded address (omitted for internal receivers) */
  address?: string;
  /** Note value in ZEC */
  amount: number;
  /** Hex-encoded memo */
  memo: string;
  /** UTF-8 memo string if valid */
  memoStr?: string;
  /** Whether this is a change note */
  change: boolean;
}

/**
 * Total balance from z_gettotalbalance
 */
export interface TotalBalance {
  /** Transparent balance in ZEC */
  transparent: string;
  /** Private (shielded) balance in ZEC */
  private: string;
  /** Total balance in ZEC */
  total: string;
}

/**
 * Operation status values
 */
export type OperationStatusValue = 'queued' | 'executing' | 'success' | 'failed' | 'cancelled';

/**
 * Operation status from z_getoperationstatus
 */
export interface OperationStatus {
  /** Operation ID */
  id: string;
  /** Current status */
  status: OperationStatusValue;
  /** Creation time (Unix timestamp) */
  creation_time: number;
  /** Method name */
  method: string;
  /** Method parameters */
  params: unknown;
  /** Error details if failed */
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Operation result from z_getoperationresult
 */
export interface OperationResult {
  /** Operation ID */
  id: string;
  /** Final status (typically 'success' or 'failed') */
  status: OperationStatusValue;
  /** Creation time (Unix timestamp) */
  creation_time: number;
  /** Result data (txid for successful sends) */
  result?: {
    txid?: string;
    [key: string]: unknown;
  };
  /** Error details if failed */
  error?: {
    code: number;
    message: string;
  };
  /** Execution time in seconds */
  execution_secs?: number;
  /** Method name */
  method: string;
  /** Method parameters */
  params: unknown;
}

/**
 * Error thrown by RPC operations
 */
export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/**
 * Error thrown when an operation times out
 */
export class OperationTimeoutError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly timeoutMs: number
  ) {
    super(`Operation ${operationId} timed out after ${timeoutMs}ms`);
    this.name = 'OperationTimeoutError';
  }
}

/**
 * HTTP fetch function type for dependency injection
 */
export type FetchFunction = (
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }>;

/**
 * Zcash RPC Client
 *
 * Provides typed methods for interacting with zcashd via JSON-RPC.
 * Supports all z_* methods needed for shielded transactions.
 *
 * @example
 * ```typescript
 * const client = new ZcashRpcClient({
 *   host: '127.0.0.1',
 *   port: 8232,
 *   auth: { username: 'user', password: 'password' }
 * });
 *
 * const balance = await client.z_getbalance('zs1...');
 * console.log(`Balance: ${balance} ZEC`);
 * ```
 */
export class ZcashRpcClient {
  private readonly host: string;
  private readonly port: number;
  private readonly auth: RpcAuth;
  private readonly timeout: number;
  private readonly protocol: 'http' | 'https';
  private readonly fetchFn: FetchFunction;
  private requestId: number = 0;

  /**
   * Creates a new ZcashRpcClient
   *
   * @param config - RPC configuration
   * @param fetchFn - Optional fetch function for testing (defaults to global fetch)
   */
  constructor(config: RpcConfig, fetchFn?: FetchFunction) {
    this.host = config.host;
    this.port = config.port;
    this.auth = config.auth;
    this.timeout = config.timeout ?? 30000;
    this.protocol = config.https ? 'https' : 'http';

    // Use provided fetch function or default to global fetch
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFunction);

    if (!this.fetchFn) {
      throw new RpcError('fetch is not available in this environment', -1);
    }
  }

  /**
   * Gets the RPC endpoint URL
   */
  private get url(): string {
    return `${this.protocol}://${this.host}:${this.port}/`;
  }

  /**
   * Gets the Authorization header value
   */
  private get authHeader(): string {
    const credentials = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString(
      'base64'
    );
    return `Basic ${credentials}`;
  }

  /**
   * Makes a JSON-RPC request to zcashd
   *
   * @param method - RPC method name
   * @param params - Method parameters
   * @returns Promise resolving to the result
   * @throws RpcError if the request fails
   */
  private async rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
    const request: JsonRpcRequest = {
      jsonrpc: '1.0',
      id: ++this.requestId,
      method,
      params,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new RpcError(
          `HTTP error: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      const json = (await response.json()) as JsonRpcResponse<T>;

      if (json.error) {
        throw new RpcError(json.error.message, json.error.code, json.error.data);
      }

      return json.result as T;
    } catch (error) {
      if (error instanceof RpcError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new RpcError(`Request timed out after ${this.timeout}ms`, -1);
        }
        throw new RpcError(error.message, -1);
      }

      throw new RpcError('Unknown error occurred', -1);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sends funds from a shielded address to multiple recipients
   *
   * @param from - Source address or 'ANY_TADDR'
   * @param amounts - Array of recipient amounts
   * @param minconf - Minimum confirmations (default: 10)
   * @param fee - Fee in ZEC or null for ZIP 317 default
   * @param privacyPolicy - Privacy policy (default: 'LegacyCompat')
   * @returns Operation ID to track the transaction
   *
   * @example
   * ```typescript
   * const opid = await client.z_sendmany(
   *   'zs1...',
   *   [{ address: 'zs1...', amount: 1.5 }],
   *   10,
   *   null,
   *   'FullPrivacy'
   * );
   * ```
   */
  async z_sendmany(
    from: string,
    amounts: ZAmount[],
    minconf: number = 10,
    fee: number | null = null,
    privacyPolicy: PrivacyPolicy = 'LegacyCompat'
  ): Promise<string> {
    const params: unknown[] = [from, amounts, minconf];

    // Only add optional params if they're specified
    if (fee !== null) {
      params.push(fee);
      params.push(privacyPolicy);
    } else {
      // Need to pass null for fee to reach privacyPolicy
      params.push(null);
      params.push(privacyPolicy);
    }

    return this.rpcCall<string>('z_sendmany', params);
  }

  /**
   * Executes a z_sendmany from a prepared request
   *
   * @param request - The prepared z_sendmany request
   * @returns Operation ID to track the transaction
   */
  async executeZSendmany(request: ZSendmanyRequest): Promise<string> {
    return this.z_sendmany(
      request.fromaddress,
      request.amounts,
      request.minconf,
      request.fee,
      request.privacyPolicy
    );
  }

  /**
   * Gets the balance of an address
   *
   * Note: This method is deprecated in zcashd. Consider using
   * z_getbalanceforaccount or z_getbalanceforviewingkey instead.
   *
   * @param address - Transparent or shielded address
   * @param minconf - Minimum confirmations (default: 1)
   * @returns Balance in ZEC
   */
  async z_getbalance(address: string, minconf: number = 1): Promise<number> {
    return this.rpcCall<number>('z_getbalance', [address, minconf]);
  }

  /**
   * Lists unspent shielded notes
   *
   * @param minconf - Minimum confirmations (default: 1)
   * @param maxconf - Maximum confirmations (default: 9999999)
   * @param includeWatchonly - Include watchonly addresses (default: false)
   * @param addresses - Filter by specific addresses (optional)
   * @returns Array of unspent notes
   */
  async z_listunspent(
    minconf: number = 1,
    maxconf: number = 9999999,
    includeWatchonly: boolean = false,
    addresses?: string[]
  ): Promise<UnspentNote[]> {
    const params: unknown[] = [minconf, maxconf, includeWatchonly];

    if (addresses && addresses.length > 0) {
      params.push(addresses);
    }

    return this.rpcCall<UnspentNote[]>('z_listunspent', params);
  }

  /**
   * Gets the total balance across all addresses
   *
   * Note: This method is deprecated in zcashd.
   *
   * @param minconf - Minimum confirmations (default: 1)
   * @param includeWatchonly - Include watchonly addresses (default: false)
   * @returns Total balance breakdown
   */
  async z_gettotalbalance(
    minconf: number = 1,
    includeWatchonly: boolean = false
  ): Promise<TotalBalance> {
    return this.rpcCall<TotalBalance>('z_gettotalbalance', [minconf, includeWatchonly]);
  }

  /**
   * Gets the status of one or more operations
   *
   * Unlike z_getoperationresult, this does not remove the operation from memory.
   *
   * @param operationIds - Operation IDs to check (empty for all)
   * @returns Array of operation statuses
   */
  async z_getoperationstatus(operationIds?: string[]): Promise<OperationStatus[]> {
    const params: unknown[] = operationIds ? [operationIds] : [];
    return this.rpcCall<OperationStatus[]>('z_getoperationstatus', params);
  }

  /**
   * Gets the result of one or more operations and removes them from memory
   *
   * @param operationIds - Operation IDs to get results for (empty for all)
   * @returns Array of operation results
   */
  async z_getoperationresult(operationIds?: string[]): Promise<OperationResult[]> {
    const params: unknown[] = operationIds ? [operationIds] : [];
    return this.rpcCall<OperationResult[]>('z_getoperationresult', params);
  }

  /**
   * Waits for an operation to complete
   *
   * Polls the operation status until it succeeds, fails, or times out.
   *
   * @param opid - Operation ID to wait for
   * @param timeoutMs - Timeout in milliseconds (default: 300000 = 5 minutes)
   * @param pollIntervalMs - Polling interval in milliseconds (default: 1000)
   * @returns The final operation result
   * @throws OperationTimeoutError if the operation times out
   * @throws RpcError if the operation fails
   */
  async waitForOperation(
    opid: string,
    timeoutMs: number = 300000,
    pollIntervalMs: number = 1000
  ): Promise<OperationResult> {
    const startTime = Date.now();

    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        throw new OperationTimeoutError(opid, timeoutMs);
      }

      const statuses = await this.z_getoperationstatus([opid]);

      if (statuses.length === 0) {
        // Operation not found, check if it completed
        const results = await this.z_getoperationresult([opid]);
        const result = results[0];
        if (result) {
          if (result.status === 'failed' && result.error) {
            throw new RpcError(result.error.message, result.error.code);
          }
          return result;
        }
        throw new RpcError(`Operation ${opid} not found`, -1);
      }

      const status = statuses[0];
      if (!status) {
        throw new RpcError(`Unexpected empty status for operation ${opid}`, -1);
      }

      if (status.status === 'success') {
        // Get the full result
        const results = await this.z_getoperationresult([opid]);
        const successResult = results[0];
        if (successResult) {
          return successResult;
        }
        // Construct a result from the status if getoperationresult returns empty
        return {
          id: status.id,
          status: status.status,
          creation_time: status.creation_time,
          method: status.method,
          params: status.params,
        };
      }

      if (status.status === 'failed') {
        const errorMessage = status.error?.message ?? 'Operation failed';
        const errorCode = status.error?.code ?? -1;
        throw new RpcError(errorMessage, errorCode);
      }

      if (status.status === 'cancelled') {
        throw new RpcError('Operation was cancelled', -1);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Sends a shielded transaction and waits for completion
   *
   * Convenience method that combines z_sendmany with waitForOperation.
   *
   * @param from - Source address
   * @param amounts - Array of recipient amounts
   * @param options - Optional parameters
   * @returns The transaction ID
   */
  async sendAndWait(
    from: string,
    amounts: ZAmount[],
    options?: {
      minconf?: number;
      fee?: number | null;
      privacyPolicy?: PrivacyPolicy;
      timeoutMs?: number;
    }
  ): Promise<string> {
    const opid = await this.z_sendmany(
      from,
      amounts,
      options?.minconf ?? 10,
      options?.fee ?? null,
      options?.privacyPolicy ?? 'LegacyCompat'
    );

    const result = await this.waitForOperation(opid, options?.timeoutMs ?? 300000);

    if (result.result?.txid) {
      return result.result.txid;
    }

    throw new RpcError('Transaction completed but no txid returned', -1);
  }

  /**
   * Makes a generic RPC call to zcashd
   *
   * Use this method for RPC calls not covered by the typed methods.
   *
   * @param method - RPC method name
   * @param params - Method parameters
   * @returns Promise resolving to the result
   * @throws RpcError if the request fails
   *
   * @example
   * ```typescript
   * // Get transaction info
   * const txInfo = await client.call('gettransaction', ['txid...']);
   * console.log('Confirmations:', txInfo.confirmations);
   * ```
   */
  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    return this.rpcCall<T>(method, params);
  }
}

/**
 * Creates a new ZcashRpcClient with the given configuration
 *
 * @param host - Host address
 * @param port - Port number
 * @param auth - Authentication credentials
 * @param options - Additional options
 * @returns A configured ZcashRpcClient instance
 */
export function createRpcClient(
  host: string,
  port: number,
  auth: RpcAuth,
  options?: { timeout?: number; https?: boolean }
): ZcashRpcClient {
  return new ZcashRpcClient({
    host,
    port,
    auth,
    timeout: options?.timeout,
    https: options?.https,
  });
}
