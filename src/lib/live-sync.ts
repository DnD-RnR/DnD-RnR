type Observer = { invalidate: () => void; status?: (connected: boolean) => void };
const observers = new Set<Observer>();
let source: EventSource | undefined;
let reconnect: number | undefined;
let connected = false;
let retryMs = 1000;
let revoked = false;

function notify() {
  for (const observer of observers) observer.invalidate();
}
function setConnected(value: boolean) {
  connected = value;
  for (const observer of observers) observer.status?.(value);
}
function disconnect() {
  window.clearTimeout(reconnect);
  reconnect = undefined;
  const previous = source;
  source = undefined;
  previous?.close();
  setConnected(false);
}
function connect() {
  if (source || revoked || !observers.size || document.hidden || !window.EventSource) return;
  const stream = new window.EventSource('/api/sync/events');
  source = stream;
  stream.addEventListener('ready', () => {
    if (source !== stream) return;
    retryMs = 1000;
    setConnected(true);
    // Always reload after reconnect: events missed while offline need no replay.
    notify();
  });
  stream.addEventListener('change', () => { if (source === stream) notify(); });
  stream.addEventListener('expired', () => {
    if (source !== stream) return;
    revoked = true;
    disconnect();
    window.dispatchEvent(new Event('session-expired'));
  });
  stream.onerror = () => {
    if (source !== stream) return;
    disconnect();
    reconnect = window.setTimeout(() => { reconnect = undefined; connect(); }, retryMs);
    retryMs = Math.min(retryMs * 2, 30000);
  };
}
function onVisibility() {
  if (document.hidden) disconnect();
  else { connect(); notify(); }
}
function onFocus() { connect(); notify(); }
function subscribe(observer: Observer) {
  observers.add(observer);
  if (observers.size === 1) {
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
  }
  observer.status?.(connected);
  connect();
  return () => {
    observers.delete(observer);
    if (!observers.size) {
      disconnect(); retryMs = 1000; revoked = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

// One SSE connection per visible browser tab. Ordinary updates follow commits;
// timers are a safety net (30 s offline / 120 s online), not the primary sync.
export function watchLive(load: () => Promise<unknown>, status?: Observer['status']) {
  let stopped = false;
  let running = false;
  let again = false;
  let timer: number | undefined;
  const refresh = async () => {
    if (stopped || document.hidden) return;
    if (running) { again = true; return; }
    window.clearTimeout(timer);
    running = true;
    try {
      do {
        again = false;
        try { await load(); } catch { /* The view handles request errors. */ }
      } while (again && !stopped && !document.hidden);
    } finally {
      running = false;
      if (!stopped) timer = window.setTimeout(trigger, connected ? 120000 : 30000);
    }
  };
  const trigger = () => { void refresh(); };
  const unsubscribe = subscribe({ invalidate: trigger, status: value => {
    status?.(value);
    if (!running && !stopped) {
      window.clearTimeout(timer);
      timer = window.setTimeout(trigger, value ? 120000 : 30000);
    }
  } });
  trigger();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    unsubscribe();
  };
}
