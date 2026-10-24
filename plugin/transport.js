// Reversible rc3-only wrapper. All request inputs remain owned by the adapter.
const DELAYS = [30_000, 60_000, 120_000, 240_000, 300_000];
const VISIBLE = ['block-start','text-delta','reasoning-delta','tool-call-delta','block-end'];
const SUCCESS = ['stop','tool-calls','max-tokens'];
export function installTransport(PiAiAdapter, readProviders, turns, now = Date.now, publish = () => {}) {
 const prototype = PiAiAdapter.prototype, original = prototype.streamWithSnapshot;
 const marker = Symbol.for('kaczev.failover.wrapper');
 if (typeof original !== 'function' || prototype[marker]) throw Error('Unsupported or already wrapped pi-ai adapter');
 const adapters = new WeakMap();
 async function* wrapped(options, snapshot) {
  const turn = options.sessionId && turns.get(String(options.sessionId));
  if (!turn || options.purpose) { yield* original.call(this, options, snapshot); return; }
  const firstRequest = !turn.requestStarted; turn.requestStarted = true;
  const token = {}; turn.statusToken = token;
  let pending;
  const clearPending = () => { clearTimeout(pending); pending = undefined; };
  const report = (phase, index, url) => {
   clearPending();
   if (turns.get(String(options.sessionId)) === turn && turn.statusToken === token) publish(String(options.sessionId), phase ? { phase, index, url, provider: options.provider } : null);
  };
  const begin = (index, url, switching = false) => {
   clearPending();
   if (switching) report('connecting', index, url);
   else if (firstRequest) {
    pending = setTimeout(() => { if (!options.signal?.aborted) report('connecting', index, url); }, 1000);
    pending.unref?.();
   }
  };
  const abort = () => report();
  options.signal?.addEventListener('abort', abort, { once: true });
  let completed = false;
  try {
   const configured = readProviders()?.[options.provider];
   const primary = this.modelOf(snapshot, options.provider, options.model).baseUrl;
   if (!configured?.enabled || !this.profileOf(snapshot, options.provider).apiKeyEnv) {
    begin(0, primary);
    let active = false;
    for await (const chunk of original.call(this, options, snapshot)) {
     if (!active && (VISIBLE.includes(chunk.type) || (chunk.type === 'finish' && SUCCESS.includes(chunk.reason?.kind)))) { report('active', 0, primary); active = true; }
     if (chunk.type === 'finish') { completed = SUCCESS.includes(chunk.reason?.kind) && !options.signal?.aborted; if (!completed) report(); }
     yield chunk;
    }
    return;
   }
   const urls = [primary, ...configured.backups];
   if (urls.length > 3) throw Error('最多添加两条备用地址');
   let providers = adapters.get(this);
   if (!providers) { providers = new Map(); adapters.set(this, providers); }
   let health = providers.get(options.provider);
   const signature = JSON.stringify(urls);
   if (!health || health.signature !== signature) {
    health = { signature, selected: 0, lines: urls.map(() => ({ failures: 0, due: 0, since: null, successes: 0 })) };
    providers.set(options.provider, health);
   }
   let route = turn.routes.get(options.provider);
   if (!route || route.health !== health) {
    const time = now(), selected = health.selected;
    const index = health.lines[0].due <= time ? 0 : health.lines[selected].due <= time ? selected : health.lines.findIndex(line => line.due <= time);
    route = { health, index, failure: null }; turn.routes.set(options.provider, route);
   }
   const attempted = new Set();
   for (;;) {
    let index = route.index;
    if (index < 0 || attempted.has(index) || health.lines[index].due > now()) {
     const order = [health.selected, ...urls.map((_, i) => i)];
     index = order.find(i => !attempted.has(i) && health.lines[i].due <= now());
     if (index === undefined) {
      report(); yield { type: 'finish', reason: { kind: 'error', failure: route.failure || { code: 'TRANSPORT', message: '所有线路正在冷却，请稍后重试' } } }; return;
     }
     route.index = index;
    }
    attempted.add(index);
    // Slow first requests get a delayed hint; actual failover/probes are immediate.
    begin(index, urls[index], (index === 0 && !!health.primaryProbe) || attempted.size > 1 || (index !== 0 && health.selected !== index));
    const receiver = Object.create(this);
    receiver.modelOf = (...args) => {
     const model = this.modelOf(...args);
     return index ? { ...model, baseUrl: urls[index] } : model;
    };
    let visible = false, advance = false;
    for await (const chunk of original.call(receiver, options, snapshot)) {
     if (VISIBLE.includes(chunk.type)) { if (!visible) report('active', index, urls[index]); visible = true; }
     if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
      report();
      if (visible && !options.signal?.aborted) throw Object.assign(Error('Stream interrupted after output; automatic replay blocked'), { code: 'FAILOVER_PARTIAL_STREAM' });
      const failure = chunk.reason.failure;
      const status = failure.status ?? Number(/^\s*(?:HTTP(?: status)?[: ]+)?([1-5]\d\d)(?:[:\s]|$)/i.exec(failure.message ?? '')?.[1]);
      const eligible = !options.signal?.aborted && !['AUTH','INVALID_REQUEST','CONTEXT_WINDOW_EXCEEDED','ABORTED','RATE_LIMIT','INVALID_CREDENTIAL','MISSING_CREDENTIAL'].includes(failure.code) &&
       (Number.isFinite(status) ? [408,502,503,504].includes(status) : ['TRANSPORT','TIMEOUT'].includes(failure.code));
      if (eligible) {
       if (index === 0) health.primaryProbe = true;
       const line = health.lines[index];
       line.due = now() + DELAYS[Math.min(line.failures, DELAYS.length - 1)]; line.failures++; line.since = null; line.successes = 0;
       route.failure = failure; route.index = -1; advance = true; break;
      }
     } else if (chunk.type === 'finish' && SUCCESS.includes(chunk.reason?.kind)) {
      const line = health.lines[index]; health.selected = index;
      if (index === 0) health.primaryProbe = false;
      if (line.since === null) line.since = now();
      line.successes++;
      if (line.successes >= 2 && now() - line.since >= 300_000) line.failures = 0;
      completed = !options.signal?.aborted;
      if (completed) report('active', index, urls[index]);
     }
     yield chunk;
    }
    if (!advance) return;
   }
  } finally {
   clearPending(); options.signal?.removeEventListener('abort', abort);
   if (!completed || options.signal?.aborted) report();
  }
 }
 prototype[marker] = wrapped; prototype.streamWithSnapshot = wrapped;
 return () => { if (prototype.streamWithSnapshot === wrapped) prototype.streamWithSnapshot = original; if (prototype[marker] === wrapped) delete prototype[marker]; };
}
