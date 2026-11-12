// Preserve visible-tab refresh intervals; serialize requests and pause hidden tabs.
// Returning to a tab always requests fresh server state.
export function poll(load: () => Promise<unknown>, interval: number | (() => number)) {
  let stopped = false;
  let running = false;
  let timer: number | undefined;
  const refresh = async () => {
    if (stopped || running || document.hidden) return;
    window.clearTimeout(timer);
    running = true;
    try { await load(); } finally {
      running = false;
      if (!stopped) timer = window.setTimeout(trigger, typeof interval === 'function' ? interval() : interval);
    }
  };
  const trigger = () => { void refresh().catch(() => { /* Caller handles errors. */ }); };
  trigger();
  window.addEventListener('focus', trigger);
  document.addEventListener('visibilitychange', trigger);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener('focus', trigger);
    document.removeEventListener('visibilitychange', trigger);
  };
}
