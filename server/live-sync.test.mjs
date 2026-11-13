import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { invokeRequestListener } from './request-listener.mjs';

const { outputText } = ts.transpileModule(readFileSync(new URL('../src/lib/live-sync.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { watchLive } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const flush = () => new Promise(resolve => setImmediate(resolve));

function browserEnvironment() {
  const savedWindow = globalThis.window, savedDocument = globalThis.document;
  const browser = new EventTarget(), document = new EventTarget();
  document.hidden = false;
  const timers = new Map(), streams = [];
  let id = 0, now = 0;
  browser.setTimeout = (callback, ms) => { timers.set(++id, { callback, due: now + ms }); return id; };
  browser.clearTimeout = key => timers.delete(key);
  browser.EventSource = class extends EventTarget {
    constructor(url) { super(); this.url = url; this.closed = false; streams.push(this); }
    close() { this.closed = true; }
  };
  globalThis.window = browser; globalThis.document = document;
  return { browser, document, streams, timers,
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].due - b[1].due).find(([, value]) => value.due <= target);
        if (!next) break;
        now = next[1].due; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now = target;
    },
    restore() { globalThis.window = savedWindow; globalThis.document = savedDocument; },
  };
}

test('views share one SSE connection, refresh on commits and use only a rare safety poll while idle', async () => {
  const env = browserEnvironment();
  let first = 0, second = 0;
  const stopA = watchLive(async () => { first++; });
  const stopB = watchLive(async () => { second++; });
  try {
    assert.equal(env.streams.length, 1);
    assert.equal(env.streams[0].url, '/api/sync/events');
    await flush(); env.streams[0].dispatchEvent(new Event('ready')); await flush();
    const before = [first, second];
    await env.advance(119999); assert.deepEqual([first, second], before);
    await env.advance(1); assert.deepEqual([first, second], before.map(value => value + 1));
    env.streams[0].dispatchEvent(new Event('change')); await flush();
    assert.deepEqual([first, second], before.map(value => value + 2));
    stopA(); assert.equal(env.streams[0].closed, false);
    stopB(); assert.equal(env.streams[0].closed, true); assert.equal(env.timers.size, 0);
  } finally { stopA(); stopB(); env.restore(); }
});

test('an invalidation arriving during a slow request is replayed without overlapping loads', async () => {
  const env = browserEnvironment();
  const releases = []; let calls = 0;
  const stop = watchLive(() => { calls++; return new Promise(resolve => releases.push(resolve)); });
  try {
    env.streams[0].dispatchEvent(new Event('ready'));
    env.streams[0].dispatchEvent(new Event('change'));
    assert.equal(calls, 1);
    releases.shift()(); await flush(); assert.equal(calls, 2);
    releases.shift()(); await flush(); assert.equal(calls, 2);
  } finally { stop(); for (const release of releases) release(); await flush(); env.restore(); }
});

test('disconnect uses 30 second fallback, reconnect catches up, and hidden tabs release their stream', async () => {
  const env = browserEnvironment(); let calls = 0;
  const stop = watchLive(async () => { calls++; });
  try {
    await flush(); env.streams[0].dispatchEvent(new Event('ready')); await flush();
    const before = calls;
    env.streams[0].onerror();
    assert.equal(env.streams[0].closed, true);
    await env.advance(30000); assert.equal(calls, before + 1);
    assert.equal(env.streams.length, 2);
    env.streams[1].dispatchEvent(new Event('ready')); await flush(); assert.equal(calls, before + 2);
    env.document.hidden = true; env.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(env.streams[1].closed, true);
    await env.advance(120000); assert.equal(calls, before + 2);
    env.document.hidden = false; env.document.dispatchEvent(new Event('visibilitychange')); await flush();
    assert.equal(env.streams.length, 3); assert.equal(calls, before + 3);
    stop(); env.browser.dispatchEvent(new Event('focus')); await env.advance(120000);
    assert.equal(calls, before + 3); assert.equal(env.timers.size, 0);
  } finally { stop(); env.restore(); }
});

test('session revocation closes SSE and informs the application without retrying the revoked stream', async () => {
  const env = browserEnvironment(); let expired = 0;
  env.browser.addEventListener('session-expired', () => expired++);
  const stop = watchLive(async () => {});
  try {
    await flush(); env.streams[0].dispatchEvent(new Event('expired'));
    assert.equal(expired, 1); assert.equal(env.streams[0].closed, true);
    env.browser.dispatchEvent(new Event('focus')); assert.equal(env.streams.length, 1);
    stop(); await env.advance(60000); assert.equal(env.streams.length, 1);
  } finally { stop(); env.restore(); }
});

test('browsers without EventSource keep a 30 second fallback', async () => {
  const env = browserEnvironment(); env.browser.EventSource = undefined;
  let calls = 0;
  const stop = watchLive(async () => { calls++; });
  try {
    await flush(); assert.equal(calls, 1);
    await env.advance(29999); assert.equal(calls, 1);
    await env.advance(1); assert.equal(calls, 2);
  } finally { stop(); env.restore(); }
});

test('idle cost model: seven tabs with four views refresh on SSE reconnection rather than every few seconds', async t => {
  const env = browserEnvironment(); let requests = 0;
  const stops = Array.from({ length: 4 }, () => watchLive(async () => { requests++; }));
  try {
    await flush(); env.streams[0].dispatchEvent(new Event('ready')); await flush();
    // Model the real 45 second stream lifetime and a one second reconnect.
    // This is a fake-browser request count, not a Firestore billing measurement.
    for (let elapsed = 46; elapsed <= 14400; elapsed += 46) {
      await env.advance(45000); env.streams.at(-1).onerror();
      await env.advance(1000); env.streams.at(-1).dispatchEvent(new Event('ready')); await flush();
    }
    const before = 7 * (14400 / 2 + 14400 / 5 + 14400 / 20);
    const after = requests * 7;
    assert.ok(after < before / 5);
    t.diagnostic(JSON.stringify({ scenario: '4h idle; seven tabs; four live views each; no writes',
      oldPeriodicGetRequests: before, newViewGetRequests: after, streamConnections: env.streams.length * 7 }));
  } finally { stops.forEach(stop => stop()); env.restore(); }
});

test('Vercel stream invocation stays pending until the response closes and releases its handlers', async () => {
  const req = { method: 'GET', url: '/api/sync/events' };
  const res = new EventEmitter(); let finished = false;
  const pending = invokeRequestListener(async () => {}, req, res).then(() => { finished = true; });
  await flush(); assert.equal(finished, false);
  res.emit('close'); await pending;
  assert.equal(finished, true); assert.equal(res.listenerCount('close'), 0); assert.equal(res.listenerCount('finish'), 0);
  await invokeRequestListener(async () => { res.writableEnded = true; res.emit('finish'); }, req, res);
  assert.equal(res.listenerCount('finish'), 0);
  await assert.rejects(invokeRequestListener(async () => { throw new Error('Listener failed'); }, req, res), /Listener failed/);
  assert.equal(res.listenerCount('close'), 0);
});
