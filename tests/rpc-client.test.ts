/**
 * Tests for Zcash RPC Client Module
 */

import {
  ZcashRpcClient,
  RpcError,
  OperationTimeoutError,
  createRpcClient,
  RpcConfig,
  UnspentNote,
  TotalBalance,
  OperationStatus,
  OperationResult,
  FetchFunction,
} from '../src/rpc-client.js';
import { ZAmount, PrivacyPolicy } from '../src/transaction-builder.js';

/**
 * Creates a mock fetch function for testing
 */
function createMockFetch(
  responseData: unknown,
  options?: { error?: boolean; httpError?: boolean; status?: number }
): FetchFunction {
  return async (_url: string, _options: unknown) => {
    if (options?.httpError) {
      return {
        ok: false,
        status: options.status ?? 500,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        if (options?.error) {
          return {
            result: null,
            error: responseData,
            id: 1,
          };
        }
        return {
          result: responseData,
          error: null,
          id: 1,
        };
      },
    };
  };
}

/**
 * Creates a mock fetch that tracks calls
 */
function createTrackedMockFetch(responses: unknown[]): {
  fetch: FetchFunction;
  calls: Array<{ url: string; body: unknown }>;
} {
  const calls: Array<{ url: string; body: unknown }> = [];
  let callIndex = 0;

  const fetch: FetchFunction = async (url: string, options: { body: string }) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const response = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        result: response,
        error: null,
        id: callIndex,
      }),
    };
  };

  return { fetch, calls };
}

describe('ZcashRpcClient', () => {
  const defaultConfig: RpcConfig = {
    host: '127.0.0.1',
    port: 8232,
    auth: { username: 'user', password: 'password' },
  };

  describe('constructor', () => {
    it('should create client with default options', () => {
      const mockFetch = createMockFetch({});
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      expect(client).toBeInstanceOf(ZcashRpcClient);
    });

    it('should accept custom timeout', () => {
      const mockFetch = createMockFetch({});
      const client = new ZcashRpcClient({ ...defaultConfig, timeout: 60000 }, mockFetch);

      expect(client).toBeInstanceOf(ZcashRpcClient);
    });

    it('should accept https option', () => {
      const mockFetch = createMockFetch({});
      const client = new ZcashRpcClient({ ...defaultConfig, https: true }, mockFetch);

      expect(client).toBeInstanceOf(ZcashRpcClient);
    });
  });

  describe('z_sendmany', () => {
    it('should send a basic transaction', async () => {
      const expectedOpid = 'opid-1234-5678-90ab';
      const { fetch, calls } = createTrackedMockFetch([expectedOpid]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      const amounts: ZAmount[] = [{ address: 'zs1...', amount: 1.5 }];
      const opid = await client.z_sendmany('zs1source...', amounts);

      expect(opid).toBe(expectedOpid);
      expect(calls).toHaveLength(1);
      expect(calls[0].body.method).toBe('z_sendmany');
    });

    it('should include all parameters', async () => {
      const expectedOpid = 'opid-test';
      const { fetch, calls } = createTrackedMockFetch([expectedOpid]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      const amounts: ZAmount[] = [
        { address: 'zs1dest...', amount: 2.0, memo: '48656c6c6f' },
      ];

      await client.z_sendmany('zs1source...', amounts, 5, 0.0001, 'FullPrivacy');

      expect(calls[0].body.params).toEqual([
        'zs1source...',
        amounts,
        5,
        0.0001,
        'FullPrivacy',
      ]);
    });

    it('should use default values when not specified', async () => {
      const { fetch, calls } = createTrackedMockFetch(['opid']);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_sendmany('zs1...', [{ address: 'zs1...', amount: 1 }]);

      const params = calls[0].body.params;
      expect(params[2]).toBe(10); // default minconf
      expect(params[3]).toBeNull(); // default fee (null for ZIP 317)
      expect(params[4]).toBe('LegacyCompat'); // default privacy policy
    });

    it('should handle RPC errors', async () => {
      const mockFetch = createMockFetch(
        { code: -5, message: 'Invalid address' },
        { error: true }
      );
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      await expect(
        client.z_sendmany('invalid', [{ address: 'zs1...', amount: 1 }])
      ).rejects.toThrow(RpcError);
    });
  });

  describe('executeZSendmany', () => {
    it('should execute a prepared z_sendmany request', async () => {
      const expectedOpid = 'opid-from-request';
      const { fetch, calls } = createTrackedMockFetch([expectedOpid]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      const request = {
        fromaddress: 'zs1source...',
        amounts: [{ address: 'zs1dest...', amount: 1.0 }],
        minconf: 5,
        fee: 0.0002,
        privacyPolicy: 'FullPrivacy' as PrivacyPolicy,
      };

      const opid = await client.executeZSendmany(request);

      expect(opid).toBe(expectedOpid);
      expect(calls[0].body.params[0]).toBe('zs1source...');
      expect(calls[0].body.params[2]).toBe(5);
      expect(calls[0].body.params[3]).toBe(0.0002);
    });
  });

  describe('z_getbalance', () => {
    it('should return balance for an address', async () => {
      const expectedBalance = 10.5;
      const mockFetch = createMockFetch(expectedBalance);
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      const balance = await client.z_getbalance('zs1...');

      expect(balance).toBe(expectedBalance);
    });

    it('should use default minconf of 1', async () => {
      const { fetch, calls } = createTrackedMockFetch([5.0]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_getbalance('zs1...');

      expect(calls[0].body.params[1]).toBe(1);
    });

    it('should accept custom minconf', async () => {
      const { fetch, calls } = createTrackedMockFetch([5.0]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_getbalance('zs1...', 6);

      expect(calls[0].body.params[1]).toBe(6);
    });
  });

  describe('z_listunspent', () => {
    const sampleNotes: UnspentNote[] = [
      {
        txid: 'abc123',
        pool: 'sapling',
        outindex: 0,
        confirmations: 10,
        spendable: true,
        address: 'zs1...',
        amount: 2.5,
        memo: '',
        change: false,
      },
      {
        txid: 'def456',
        pool: 'orchard',
        outindex: 1,
        confirmations: 5,
        spendable: true,
        address: 'u1...',
        amount: 1.0,
        memo: '48656c6c6f',
        memoStr: 'Hello',
        change: true,
      },
    ];

    it('should return list of unspent notes', async () => {
      const mockFetch = createMockFetch(sampleNotes);
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      const notes = await client.z_listunspent();

      expect(notes).toHaveLength(2);
      expect(notes[0].pool).toBe('sapling');
      expect(notes[1].pool).toBe('orchard');
    });

    it('should use default parameters', async () => {
      const { fetch, calls } = createTrackedMockFetch([[]]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_listunspent();

      expect(calls[0].body.params).toEqual([1, 9999999, false]);
    });

    it('should accept custom parameters', async () => {
      const { fetch, calls } = createTrackedMockFetch([[]]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_listunspent(5, 100, true, ['zs1addr1', 'zs1addr2']);

      expect(calls[0].body.params).toEqual([5, 100, true, ['zs1addr1', 'zs1addr2']]);
    });

    it('should not include addresses param when empty', async () => {
      const { fetch, calls } = createTrackedMockFetch([[]]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_listunspent(1, 9999999, false);

      expect(calls[0].body.params).toEqual([1, 9999999, false]);
    });
  });

  describe('z_gettotalbalance', () => {
    const sampleBalance: TotalBalance = {
      transparent: '1.00000000',
      private: '5.50000000',
      total: '6.50000000',
    };

    it('should return total balance breakdown', async () => {
      const mockFetch = createMockFetch(sampleBalance);
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      const balance = await client.z_gettotalbalance();

      expect(balance.transparent).toBe('1.00000000');
      expect(balance.private).toBe('5.50000000');
      expect(balance.total).toBe('6.50000000');
    });

    it('should use default parameters', async () => {
      const { fetch, calls } = createTrackedMockFetch([sampleBalance]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_gettotalbalance();

      expect(calls[0].body.params).toEqual([1, false]);
    });

    it('should accept custom parameters', async () => {
      const { fetch, calls } = createTrackedMockFetch([sampleBalance]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_gettotalbalance(6, true);

      expect(calls[0].body.params).toEqual([6, true]);
    });
  });

  describe('z_getoperationstatus', () => {
    const sampleStatuses: OperationStatus[] = [
      {
        id: 'opid-1',
        status: 'executing',
        creation_time: 1700000000,
        method: 'z_sendmany',
        params: {},
      },
      {
        id: 'opid-2',
        status: 'success',
        creation_time: 1699999000,
        method: 'z_sendmany',
        params: {},
      },
    ];

    it('should return all operation statuses', async () => {
      const mockFetch = createMockFetch(sampleStatuses);
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      const statuses = await client.z_getoperationstatus();

      expect(statuses).toHaveLength(2);
      expect(statuses[0].status).toBe('executing');
      expect(statuses[1].status).toBe('success');
    });

    it('should filter by operation IDs', async () => {
      const { fetch, calls } = createTrackedMockFetch([[sampleStatuses[0]]]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_getoperationstatus(['opid-1']);

      expect(calls[0].body.params).toEqual([['opid-1']]);
    });
  });

  describe('z_getoperationresult', () => {
    const sampleResults: OperationResult[] = [
      {
        id: 'opid-1',
        status: 'success',
        creation_time: 1700000000,
        result: { txid: 'tx123abc' },
        execution_secs: 2.5,
        method: 'z_sendmany',
        params: {},
      },
    ];

    it('should return operation results', async () => {
      const mockFetch = createMockFetch(sampleResults);
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      const results = await client.z_getoperationresult();

      expect(results).toHaveLength(1);
      expect(results[0].result?.txid).toBe('tx123abc');
    });

    it('should filter by operation IDs', async () => {
      const { fetch, calls } = createTrackedMockFetch([sampleResults]);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await client.z_getoperationresult(['opid-1']);

      expect(calls[0].body.params).toEqual([['opid-1']]);
    });
  });

  describe('waitForOperation', () => {
    it('should wait for successful operation', async () => {
      const executingStatus: OperationStatus[] = [
        {
          id: 'opid-wait',
          status: 'executing',
          creation_time: Date.now() / 1000,
          method: 'z_sendmany',
          params: {},
        },
      ];

      const successStatus: OperationStatus[] = [
        {
          id: 'opid-wait',
          status: 'success',
          creation_time: Date.now() / 1000,
          method: 'z_sendmany',
          params: {},
        },
      ];

      const successResult: OperationResult[] = [
        {
          id: 'opid-wait',
          status: 'success',
          creation_time: Date.now() / 1000,
          result: { txid: 'txid-success' },
          method: 'z_sendmany',
          params: {},
        },
      ];

      // First call returns executing, second returns success, third returns result
      const responses = [executingStatus, successStatus, successResult];
      const { fetch } = createTrackedMockFetch(responses);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      const result = await client.waitForOperation('opid-wait', 10000, 10);

      expect(result.status).toBe('success');
      expect(result.result?.txid).toBe('txid-success');
    });

    it('should throw on failed operation', async () => {
      const failedStatus: OperationStatus[] = [
        {
          id: 'opid-fail',
          status: 'failed',
          creation_time: Date.now() / 1000,
          method: 'z_sendmany',
          params: {},
          error: { code: -4, message: 'Insufficient funds' },
        },
      ];

      const mockFetch = createMockFetch(failedStatus);
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      await expect(client.waitForOperation('opid-fail', 1000, 10)).rejects.toThrow(
        'Insufficient funds'
      );
    });

    it('should throw on cancelled operation', async () => {
      const cancelledStatus: OperationStatus[] = [
        {
          id: 'opid-cancel',
          status: 'cancelled',
          creation_time: Date.now() / 1000,
          method: 'z_sendmany',
          params: {},
        },
      ];

      const mockFetch = createMockFetch(cancelledStatus);
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      await expect(client.waitForOperation('opid-cancel', 1000, 10)).rejects.toThrow(
        'Operation was cancelled'
      );
    });

    it('should throw timeout error when operation takes too long', async () => {
      const executingStatus: OperationStatus[] = [
        {
          id: 'opid-slow',
          status: 'executing',
          creation_time: Date.now() / 1000,
          method: 'z_sendmany',
          params: {},
        },
      ];

      // Always return executing
      const mockFetch = createMockFetch(executingStatus);
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      await expect(client.waitForOperation('opid-slow', 50, 10)).rejects.toThrow(
        OperationTimeoutError
      );
    });

    it('should check getoperationresult when status not found', async () => {
      // First call returns empty status (operation already completed)
      // Second call returns result from getoperationresult
      const successResult: OperationResult[] = [
        {
          id: 'opid-done',
          status: 'success',
          creation_time: Date.now() / 1000,
          result: { txid: 'txid-already-done' },
          method: 'z_sendmany',
          params: {},
        },
      ];

      const responses = [
        [], // getoperationstatus returns empty
        successResult, // getoperationresult returns the completed result
      ];
      const { fetch } = createTrackedMockFetch(responses);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      const result = await client.waitForOperation('opid-done', 1000, 10);

      expect(result.result?.txid).toBe('txid-already-done');
    });
  });

  describe('sendAndWait', () => {
    it('should send and wait for transaction completion', async () => {
      const opid = 'opid-send-wait';
      const successStatus: OperationStatus[] = [
        {
          id: opid,
          status: 'success',
          creation_time: Date.now() / 1000,
          method: 'z_sendmany',
          params: {},
        },
      ];
      const successResult: OperationResult[] = [
        {
          id: opid,
          status: 'success',
          creation_time: Date.now() / 1000,
          result: { txid: 'final-txid' },
          method: 'z_sendmany',
          params: {},
        },
      ];

      const responses = [opid, successStatus, successResult];
      const { fetch } = createTrackedMockFetch(responses);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      const txid = await client.sendAndWait(
        'zs1source...',
        [{ address: 'zs1dest...', amount: 1.0 }],
        { timeoutMs: 5000 }
      );

      expect(txid).toBe('final-txid');
    });

    it('should throw if no txid in result', async () => {
      const opid = 'opid-no-txid';
      const successStatus: OperationStatus[] = [
        {
          id: opid,
          status: 'success',
          creation_time: Date.now() / 1000,
          method: 'z_sendmany',
          params: {},
        },
      ];
      const successResult: OperationResult[] = [
        {
          id: opid,
          status: 'success',
          creation_time: Date.now() / 1000,
          result: {}, // No txid
          method: 'z_sendmany',
          params: {},
        },
      ];

      const responses = [opid, successStatus, successResult];
      const { fetch } = createTrackedMockFetch(responses);
      const client = new ZcashRpcClient(defaultConfig, fetch);

      await expect(
        client.sendAndWait('zs1source...', [{ address: 'zs1dest...', amount: 1.0 }])
      ).rejects.toThrow('Transaction completed but no txid returned');
    });
  });

  describe('Error handling', () => {
    it('should handle HTTP errors', async () => {
      const mockFetch = createMockFetch({}, { httpError: true, status: 401 });
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      await expect(client.z_getbalance('zs1...')).rejects.toThrow(RpcError);
    });

    it('should handle network errors', async () => {
      const mockFetch: FetchFunction = async () => {
        throw new Error('Network error');
      };
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      await expect(client.z_getbalance('zs1...')).rejects.toThrow('Network error');
    });

    it('should handle RPC errors with code and message', async () => {
      const mockFetch = createMockFetch(
        { code: -8, message: 'Invalid parameter' },
        { error: true }
      );
      const client = new ZcashRpcClient(defaultConfig, mockFetch);

      try {
        await client.z_getbalance('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(RpcError);
        expect((error as RpcError).code).toBe(-8);
        expect((error as RpcError).message).toBe('Invalid parameter');
      }
    });
  });
});

describe('createRpcClient', () => {
  it('should create a configured client', () => {
    const mockFetch = createMockFetch({});
    // Override the global fetch for this test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const client = createRpcClient('localhost', 8232, { username: 'user', password: 'pass' });
      expect(client).toBeInstanceOf(ZcashRpcClient);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('RpcError', () => {
  it('should have correct properties', () => {
    const error = new RpcError('Test message', -5, { extra: 'data' });

    expect(error.name).toBe('RpcError');
    expect(error.message).toBe('Test message');
    expect(error.code).toBe(-5);
    expect(error.data).toEqual({ extra: 'data' });
  });
});

describe('OperationTimeoutError', () => {
  it('should have correct properties', () => {
    const error = new OperationTimeoutError('opid-123', 30000);

    expect(error.name).toBe('OperationTimeoutError');
    expect(error.operationId).toBe('opid-123');
    expect(error.timeoutMs).toBe(30000);
    expect(error.message).toContain('opid-123');
    expect(error.message).toContain('30000ms');
  });
});

describe('Additional edge cases', () => {
  const defaultConfig: RpcConfig = {
    host: '127.0.0.1',
    port: 8232,
    auth: { username: 'user', password: 'password' },
  };

  it('should handle timeout/abort errors', async () => {
    const mockFetch: FetchFunction = async () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    };
    const client = new ZcashRpcClient(defaultConfig, mockFetch);

    await expect(client.z_getbalance('zs1...')).rejects.toThrow('timed out');
  });

  it('should handle unknown non-Error exceptions', async () => {
    const mockFetch: FetchFunction = async () => {
      throw 'string error'; // Non-Error thrown
    };
    const client = new ZcashRpcClient(defaultConfig, mockFetch);

    await expect(client.z_getbalance('zs1...')).rejects.toThrow('Unknown error occurred');
  });

  it('should handle empty getoperationresult when status is success', async () => {
    const opid = 'opid-no-result';
    const successStatus: OperationStatus[] = [
      {
        id: opid,
        status: 'success',
        creation_time: Date.now() / 1000,
        method: 'z_sendmany',
        params: {},
      },
    ];

    // First call returns success status, second returns empty result
    const responses = [successStatus, []];
    const { fetch } = createTrackedMockFetch(responses);
    const client = new ZcashRpcClient(defaultConfig, fetch);

    const result = await client.waitForOperation(opid, 1000, 10);

    expect(result.status).toBe('success');
    expect(result.id).toBe(opid);
  });

  it('should handle operation not found in both status and result', async () => {
    // Both calls return empty arrays
    const responses = [[], []];
    const { fetch } = createTrackedMockFetch(responses);
    const client = new ZcashRpcClient(defaultConfig, fetch);

    await expect(client.waitForOperation('opid-missing', 1000, 10)).rejects.toThrow(
      'Operation opid-missing not found'
    );
  });

  it('should handle failed operation from getoperationresult', async () => {
    const failedResult: OperationResult[] = [
      {
        id: 'opid-fail-result',
        status: 'failed',
        creation_time: Date.now() / 1000,
        method: 'z_sendmany',
        params: {},
        error: { code: -10, message: 'Failed in result' },
      },
    ];

    // Status returns empty, result returns failed
    const responses = [[], failedResult];
    const { fetch } = createTrackedMockFetch(responses);
    const client = new ZcashRpcClient(defaultConfig, fetch);

    await expect(client.waitForOperation('opid-fail-result', 1000, 10)).rejects.toThrow(
      'Failed in result'
    );
  });
});
