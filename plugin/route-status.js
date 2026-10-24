// Ephemeral observations; never persisted in session logs or provider settings.
export const STATUS_PATH = '/api/provider-line-failover/status';
export function displayURL(value) {
 try {
  const url = new URL(value);
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  return url.href.replace(/\/+$/, '');
 } catch { return ''; }
}
export function createStatusChannel() {
 const states = new Map(), confirmed = new Map(), listeners = new Map(), closers = new Set();
 const notify = (id, value) => { for (const send of listeners.get(id) ?? []) send(value); };
 return {
  publish(id, value) {
   id = String(id);
   const state = value ? { ...value, url: displayURL(value.url) } : confirmed.get(id) ?? null;
   if (value?.phase === 'active') confirmed.set(id, state);
   if (state) states.set(id, state); else states.delete(id);
   notify(id, state);
  },
  fetch(request) {
   const id = new URL(request.url).searchParams.get('sessionId');
   if (!id || id.length > 256) return new Response('Invalid session', { status: 400 });
   const encoder = new TextEncoder(); let send, timer, close;
   const cleanup = () => {
    clearInterval(timer); request.signal.removeEventListener('abort', close); closers.delete(close);
    const group = listeners.get(id); group?.delete(send); if (!group?.size) listeners.delete(id);
   };
   const stream = new ReadableStream({
    start(controller) {
     close = () => { cleanup(); try { controller.close(); } catch {} }; closers.add(close);
     send = value => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); } catch { cleanup(); } };
     if (!listeners.has(id)) listeners.set(id, new Set());
     listeners.get(id).add(send); send(states.get(id) ?? null);
     timer = setInterval(() => { try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { cleanup(); } }, 20_000);
     timer.unref?.(); request.signal.addEventListener('abort', close, { once: true });
     if (request.signal.aborted) close();
    }, cancel: cleanup,
   });
   return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  },
  dispose() { for (const close of [...closers]) close(); states.clear(); confirmed.clear(); listeners.clear(); },
 };
}
