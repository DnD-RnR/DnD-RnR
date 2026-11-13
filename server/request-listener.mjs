// Vercel must keep the invocation alive until a stream ends. Installing these
// listeners before invoking the app also handles immediate authorization errors.
export async function invokeRequestListener(listener, req, res) {
  const isStream = req.method === 'GET' && new URL(req.url, 'http://localhost').pathname.endsWith('/events');
  if (!isStream) return await listener(req, res);
  let complete;
  const ended = new Promise(resolve => { complete = resolve; });
  res.once('finish', complete);
  res.once('close', complete);
  try {
    await listener(req, res);
    if (!res.writableEnded && !res.destroyed) await ended;
  } finally {
    res.removeListener('finish', complete);
    res.removeListener('close', complete);
  }
}
