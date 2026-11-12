import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const { outputText } = ts.transpileModule(readFileSync(new URL('../src/lib/poll.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { poll } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const flush = () => new Promise(resolve => setImmediate(resolve));

test('poll serializes slow requests, pauses hidden tabs, refreshes on return and cleans up', async () => {
  const savedWindow = globalThis.window, savedDocument = globalThis.document;
  const browser = new EventTarget(), document = new EventTarget();
  document.hidden = false;
  let tick, cleared = false, calls = 0, finish, delay;
  browser.setTimeout = (callback, ms) => { tick = callback; delay = ms; return 1; };
  browser.clearTimeout = () => { cleared = true; };
  globalThis.window = browser; globalThis.document = document;
  try {
    const stop = poll(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, () => calls === 1 ? 2000 : 10000);
    assert.equal(calls, 1);
    browser.dispatchEvent(new Event('focus')); browser.dispatchEvent(new Event('focus')); assert.equal(calls, 1);
    finish(); await flush();
    assert.equal(delay, 2000);
    document.hidden = true; tick(); assert.equal(calls, 1);
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(calls, 2);
    finish(); await flush(); assert.equal(delay, 10000);
    stop();
    tick(); browser.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(calls, 2); assert.equal(cleared, true);
  } finally { globalThis.window = savedWindow; globalThis.document = savedDocument; }
});
