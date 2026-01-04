/**
 * Storage Adapter Tests
 *
 * Tests for the in-memory storage implementations.
 * These tests verify the contract that production implementations must follow.
 */

import {
  MemoryIdempotencyStore,
  MemoryRateLimitStore,
  MemoryAuditLogSink,
  MemoryWithdrawalStatusStore,
  createMemoryStores,
  UserLimitData,
  WithdrawalResult,
  WithdrawalStatus,
  AuditEvent,
  AuditEventType,
  AuditSeverity,
} from '../src/index.js';

describe('MemoryIdempotencyStore', () => {
  let store: MemoryIdempotencyStore;

  beforeEach(() => {
    store = new MemoryIdempotencyStore();
  });

  describe('basic operations', () => {
    it('should return null for non-existent request ID', async () => {
      const result = await store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should store and retrieve a result', async () => {
      const result: WithdrawalResult = {
        success: true,
        transactionId: 'tx-123',
        requestId: 'req-123',
        completedAt: new Date(),
      };

      await store.set('req-123', result);
      const retrieved = await store.get('req-123');

      expect(retrieved).toEqual(result);
    });

    it('should check existence with has()', async () => {
      expect(await store.has('req-123')).toBe(false);

      await store.set('req-123', { success: true, requestId: 'req-123' });

      expect(await store.has('req-123')).toBe(true);
    });

    it('should delete entries', async () => {
      await store.set('req-123', { success: true, requestId: 'req-123' });

      const deleted = await store.delete('req-123');
      expect(deleted).toBe(true);

      expect(await store.has('req-123')).toBe(false);
    });

    it('should return false when deleting non-existent entry', async () => {
      const deleted = await store.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('TTL handling', () => {
    it('should respect TTL and expire entries', async () => {
      const result: WithdrawalResult = {
        success: true,
        requestId: 'req-123',
      };

      // Set with 1ms TTL
      await store.set('req-123', result, 1);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should be expired
      const retrieved = await store.get('req-123');
      expect(retrieved).toBeNull();
    });

    it('should not expire entries without TTL', async () => {
      const result: WithdrawalResult = {
        success: true,
        requestId: 'req-123',
      };

      // Set without TTL
      await store.set('req-123', result);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Should still be there
      const retrieved = await store.get('req-123');
      expect(retrieved).toEqual(result);
    });
  });

  describe('utility methods', () => {
    it('should track size correctly', async () => {
      expect(store.size()).toBe(0);

      await store.set('req-1', { success: true, requestId: 'req-1' });
      expect(store.size()).toBe(1);

      await store.set('req-2', { success: true, requestId: 'req-2' });
      expect(store.size()).toBe(2);

      await store.delete('req-1');
      expect(store.size()).toBe(1);
    });

    it('should clear all entries', async () => {
      await store.set('req-1', { success: true, requestId: 'req-1' });
      await store.set('req-2', { success: true, requestId: 'req-2' });

      store.clear();

      expect(store.size()).toBe(0);
      expect(await store.has('req-1')).toBe(false);
      expect(await store.has('req-2')).toBe(false);
    });

    it('should cleanup expired entries', async () => {
      await store.set('expired', { success: true, requestId: 'expired' }, 1);
      await store.set('valid', { success: true, requestId: 'valid' });

      await new Promise(resolve => setTimeout(resolve, 10));

      const removed = store.cleanup();
      expect(removed).toBe(1);
      expect(store.size()).toBe(1);
      expect(await store.has('valid')).toBe(true);
    });
  });
});

describe('MemoryRateLimitStore', () => {
  let store: MemoryRateLimitStore;

  beforeEach(() => {
    store = new MemoryRateLimitStore();
  });

  it('should return null for unknown user', async () => {
    const limits = await store.getUserLimits('unknown-user');
    expect(limits).toBeNull();
  });

  it('should store and retrieve user limits', async () => {
    const data: UserLimitData = {
      userId: 'user-123',
      withdrawalsThisHour: 3,
      withdrawalsToday: 10,
      amountToday: 500_000_000n,
      lastWithdrawalTime: Date.now(),
      hourlyWindowStart: Date.now() - 1800000,
      dailyWindowStart: Date.now() - 43200000,
    };

    await store.setUserLimits('user-123', data);
    const retrieved = await store.getUserLimits('user-123');

    expect(retrieved).toEqual(data);
  });

  it('should reset user limits', async () => {
    const data: UserLimitData = {
      userId: 'user-123',
      withdrawalsThisHour: 5,
      withdrawalsToday: 15,
      amountToday: 1_000_000_000n,
      lastWithdrawalTime: Date.now(),
      hourlyWindowStart: Date.now(),
      dailyWindowStart: Date.now(),
    };

    await store.setUserLimits('user-123', data);
    await store.reset('user-123');

    const retrieved = await store.getUserLimits('user-123');
    expect(retrieved).toBeNull();
  });

  it('should track size correctly', async () => {
    expect(store.size()).toBe(0);

    await store.setUserLimits('user-1', {
      userId: 'user-1',
      withdrawalsThisHour: 0,
      withdrawalsToday: 0,
      amountToday: 0n,
      lastWithdrawalTime: 0,
      hourlyWindowStart: 0,
      dailyWindowStart: 0,
    });

    expect(store.size()).toBe(1);
  });

  it('should list user IDs', async () => {
    await store.setUserLimits('user-1', {
      userId: 'user-1',
      withdrawalsThisHour: 0,
      withdrawalsToday: 0,
      amountToday: 0n,
      lastWithdrawalTime: 0,
      hourlyWindowStart: 0,
      dailyWindowStart: 0,
    });

    await store.setUserLimits('user-2', {
      userId: 'user-2',
      withdrawalsThisHour: 0,
      withdrawalsToday: 0,
      amountToday: 0n,
      lastWithdrawalTime: 0,
      hourlyWindowStart: 0,
      dailyWindowStart: 0,
    });

    const userIds = store.getUserIds();
    expect(userIds).toContain('user-1');
    expect(userIds).toContain('user-2');
    expect(userIds.length).toBe(2);
  });

  it('should clear all data', () => {
    store.clear();
    expect(store.size()).toBe(0);
  });
});

describe('MemoryAuditLogSink', () => {
  let sink: MemoryAuditLogSink;

  beforeEach(() => {
    sink = new MemoryAuditLogSink();
  });

  const createEvent = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date(),
    eventType: AuditEventType.WITHDRAWAL_COMPLETED,
    severity: AuditSeverity.INFO,
    userId: 'user-123',
    ...overrides,
  });

  it('should append events', async () => {
    const event = createEvent();
    await sink.append(event);

    expect(await sink.count()).toBe(1);
  });

  it('should query all events without filter', async () => {
    await sink.append(createEvent({ id: 'event-1' }));
    await sink.append(createEvent({ id: 'event-2' }));
    await sink.append(createEvent({ id: 'event-3' }));

    const events = await sink.query({});
    expect(events.length).toBe(3);
  });

  it('should filter by event type', async () => {
    await sink.append(createEvent({ eventType: AuditEventType.WITHDRAWAL_COMPLETED }));
    await sink.append(createEvent({ eventType: AuditEventType.WITHDRAWAL_FAILED }));
    await sink.append(createEvent({ eventType: AuditEventType.WITHDRAWAL_COMPLETED }));

    const events = await sink.query({
      eventTypes: [AuditEventType.WITHDRAWAL_COMPLETED],
    });

    expect(events.length).toBe(2);
    expect(events.every(e => e.eventType === AuditEventType.WITHDRAWAL_COMPLETED)).toBe(true);
  });

  it('should filter by minimum severity', async () => {
    await sink.append(createEvent({ severity: AuditSeverity.INFO }));
    await sink.append(createEvent({ severity: AuditSeverity.WARNING }));
    await sink.append(createEvent({ severity: AuditSeverity.ERROR }));

    const events = await sink.query({
      minSeverity: AuditSeverity.WARNING,
    });

    expect(events.length).toBe(2);
    expect(events.some(e => e.severity === AuditSeverity.INFO)).toBe(false);
  });

  it('should filter by user ID', async () => {
    await sink.append(createEvent({ userId: 'user-1' }));
    await sink.append(createEvent({ userId: 'user-2' }));
    await sink.append(createEvent({ userId: 'user-1' }));

    const events = await sink.query({ userId: 'user-1' });

    expect(events.length).toBe(2);
    expect(events.every(e => e.userId === 'user-1')).toBe(true);
  });

  it('should filter by date range', async () => {
    const now = Date.now();
    const event1 = createEvent({ timestamp: new Date(now - 3600000) }); // 1 hour ago
    const event2 = createEvent({ timestamp: new Date(now - 1800000) }); // 30 min ago
    const event3 = createEvent({ timestamp: new Date(now) }); // now

    await sink.append(event1);
    await sink.append(event2);
    await sink.append(event3);

    const events = await sink.query({
      startDate: new Date(now - 2000000),
      endDate: new Date(now - 1000000),
    });

    expect(events.length).toBe(1);
  });

  it('should support pagination with limit and offset', async () => {
    for (let i = 0; i < 10; i++) {
      await sink.append(createEvent({ id: `event-${i}` }));
    }

    const page1 = await sink.query({ limit: 3 });
    expect(page1.length).toBe(3);

    const page2 = await sink.query({ limit: 3, offset: 3 });
    expect(page2.length).toBe(3);

    // Verify no overlap
    const page1Ids = page1.map(e => e.id);
    const page2Ids = page2.map(e => e.id);
    expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false);
  });

  it('should get last hash', async () => {
    const genesisHash = '0'.repeat(64);
    expect(await sink.getLastHash()).toBe(genesisHash);

    await sink.append(createEvent({ hash: 'abc123' }));
    expect(await sink.getLastHash()).toBe('abc123');
  });

  it('should respect max events limit', async () => {
    const smallSink = new MemoryAuditLogSink(5);

    for (let i = 0; i < 10; i++) {
      await smallSink.append(createEvent({ id: `event-${i}` }));
    }

    expect(await smallSink.count()).toBe(5);

    // Should have the last 5 events
    const events = await smallSink.query({});
    const ids = events.map(e => e.id);
    expect(ids).toContain('event-9');
    expect(ids).toContain('event-5');
    expect(ids).not.toContain('event-0');
  });

  it('should clear all events', () => {
    sink.clear();
    expect(sink.getAll().length).toBe(0);
  });
});

describe('MemoryWithdrawalStatusStore', () => {
  let store: MemoryWithdrawalStatusStore;

  beforeEach(() => {
    store = new MemoryWithdrawalStatusStore();
  });

  const createStatus = (overrides: Partial<WithdrawalStatus> = {}): WithdrawalStatus => ({
    requestId: `req-${Date.now()}`,
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it('should return null for unknown request ID', async () => {
    const status = await store.get('unknown');
    expect(status).toBeNull();
  });

  it('should store and retrieve by request ID', async () => {
    const status = createStatus({ requestId: 'req-123' });
    await store.set(status);

    const retrieved = await store.get('req-123');
    expect(retrieved).toEqual(status);
  });

  it('should store and retrieve by txid', async () => {
    const status = createStatus({
      requestId: 'req-123',
      txid: 'tx-abc',
      status: 'submitted',
    });

    await store.set(status);

    const retrieved = await store.getByTxid('tx-abc');
    expect(retrieved).toEqual(status);
  });

  it('should return null for unknown txid', async () => {
    const status = await store.getByTxid('unknown-txid');
    expect(status).toBeNull();
  });

  it('should list by status', async () => {
    await store.set(createStatus({ requestId: 'req-1', status: 'pending' }));
    await store.set(createStatus({ requestId: 'req-2', status: 'submitted' }));
    await store.set(createStatus({ requestId: 'req-3', status: 'pending' }));
    await store.set(createStatus({ requestId: 'req-4', status: 'confirmed' }));

    const pending = await store.listByStatus('pending');
    expect(pending.length).toBe(2);
    expect(pending.every(s => s.status === 'pending')).toBe(true);

    const confirmed = await store.listByStatus('confirmed');
    expect(confirmed.length).toBe(1);
  });

  it('should list pending withdrawals (pending, submitted, mempool)', async () => {
    await store.set(createStatus({ requestId: 'req-1', status: 'pending' }));
    await store.set(createStatus({ requestId: 'req-2', status: 'submitted' }));
    await store.set(createStatus({ requestId: 'req-3', status: 'mempool' }));
    await store.set(createStatus({ requestId: 'req-4', status: 'confirmed' }));
    await store.set(createStatus({ requestId: 'req-5', status: 'failed' }));

    const pending = await store.listPending();
    expect(pending.length).toBe(3);

    const statuses = pending.map(p => p.status);
    expect(statuses).toContain('pending');
    expect(statuses).toContain('submitted');
    expect(statuses).toContain('mempool');
    expect(statuses).not.toContain('confirmed');
    expect(statuses).not.toContain('failed');
  });

  it('should update status correctly', async () => {
    const initial = createStatus({
      requestId: 'req-123',
      status: 'pending',
      createdAt: new Date('2024-01-01'),
    });
    await store.set(initial);

    const updated = createStatus({
      requestId: 'req-123',
      status: 'submitted',
      txid: 'tx-abc',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    });
    await store.set(updated);

    const retrieved = await store.get('req-123');
    expect(retrieved?.status).toBe('submitted');
    expect(retrieved?.txid).toBe('tx-abc');
  });

  it('should track size correctly', async () => {
    expect(store.size()).toBe(0);

    await store.set(createStatus({ requestId: 'req-1' }));
    expect(store.size()).toBe(1);

    await store.set(createStatus({ requestId: 'req-2' }));
    expect(store.size()).toBe(2);

    // Updating same request ID shouldn't increase size
    await store.set(createStatus({ requestId: 'req-1', status: 'confirmed' }));
    expect(store.size()).toBe(2);
  });

  it('should clear all data', () => {
    store.clear();
    expect(store.size()).toBe(0);
  });
});

describe('createMemoryStores', () => {
  it('should create all store instances', () => {
    const stores = createMemoryStores();

    expect(stores.idempotencyStore).toBeInstanceOf(MemoryIdempotencyStore);
    expect(stores.rateLimitStore).toBeInstanceOf(MemoryRateLimitStore);
    expect(stores.auditLogSink).toBeInstanceOf(MemoryAuditLogSink);
    expect(stores.withdrawalStatusStore).toBeInstanceOf(MemoryWithdrawalStatusStore);
  });

  it('should create independent instances each time', () => {
    const stores1 = createMemoryStores();
    const stores2 = createMemoryStores();

    expect(stores1.idempotencyStore).not.toBe(stores2.idempotencyStore);
  });
});
