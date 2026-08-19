import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { createHealthServer } from '../src/api/health.ts';

test('healthz reports process liveness', async () => {
  const server = await createHealthServer('127.0.0.1', 0, {
    isDatabaseReady: () => true,
    getAssistantStatus: () => ({ state: 'starting', transport: 'test', transportState: 'idle' }),
  });
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('readyz is 503 while starting and 200 after initialization', async () => {
  let state: 'starting' | 'ready' = 'starting';
  const server = await createHealthServer('127.0.0.1', 0, {
    isDatabaseReady: () => true,
    getAssistantStatus: () => ({ state, transport: 'test', transportState: 'open' }),
  });
  try {
    const address = server.address() as AddressInfo;
    let response = await fetch(`http://127.0.0.1:${address.port}/readyz`);
    assert.equal(response.status, 503);
    state = 'ready';
    response = await fetch(`http://127.0.0.1:${address.port}/readyz`);
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean; database: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.database, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
