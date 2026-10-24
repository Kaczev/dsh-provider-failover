// No fetch monkeypatching, provider re-registration, or persisted settings changes.
export const name = 'provider-line-failover';
export const inject = ['llm'];
export function validate(config = {}) {
  const providers = Object.create(null);
  for (const [id, entry] of Object.entries(config.providers ?? {})) {
    if (!entry.enabled) continue;
    if (entry.confirmCredentialRecipients !== true) throw Error('Explicit credential-recipient confirmation required: ' + id);
    if (!Array.isArray(entry.backups) || !entry.backups.length) throw Error('Missing backups: ' + id);
    const backups = entry.backups.map(value => {
      const url = new URL(value);
      const local = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(config.allowLocalHttp === true && local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw Error('Unsafe backup URL: ' + id);
      return url.href.replace(/\/+$/, '');
    });
    if (new Set(backups).size !== backups.length) throw Error('Duplicate backups: ' + id);
    providers[id] = Object.freeze({ backups: Object.freeze(backups) });
  }
  return Object.freeze(providers);
}
export function eligible(failure, signal) {
  if (signal?.aborted || !failure) return false;
  if (['AUTH','INVALID_REQUEST','CONTEXT_WINDOW_EXCEEDED','ABORTED','RATE_LIMIT'].includes(failure.code)) return false;
  // pi-ai 1.1.0 serializes APIError.status into its leading error text.
  // Never search arbitrary JSON/body numbers for HTTP statuses.
  const status = failure.status ?? Number(/^\s*(?:HTTP(?: status)?[: ]+)?([1-5]\d\d)(?:[:\s]|$)/i.exec(failure.message ?? '')?.[1]);
  if (Number.isFinite(status)) return [408,502,503,504].includes(status);
  return ['TRANSPORT','TIMEOUT'].includes(failure.code);
}
export function createRouter(config = {}) {
  const providers = validate(config);
  const requests = new WeakMap();
  function state(options) {
    const entry = providers[options.provider];
    const key = options.transportRequest;
    if (!entry || !key || typeof key !== 'object' || options.purpose) return;
    let value = requests.get(key);
    if (!value) { value = new Map(); requests.set(key, value); }
    let route = value.get(options.provider);
    if (!route) { route = { index: 0, backups: entry.backups }; value.set(options.provider, route); }
    return route;
  }
  return {
    baseURL(options, primary) { const route = state(options); return route?.index ? route.backups[route.index - 1] : primary; },
    async *stream(options, next) {
      const route = state(options);
      if (!route) { yield* next(); return; }
      let visible = false;
      try {
        for await (const chunk of next()) {
          if (['block-start','text-delta','reasoning-delta','tool-call-delta','block-end'].includes(chunk.type)) visible = true;
          if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
            if (visible && !options.signal?.aborted) throw Object.assign(Error('Stream interrupted after output; automatic replay blocked'), { code: 'FAILOVER_PARTIAL_STREAM' });
            if (eligible(chunk.reason.failure, options.signal)) route.index = Math.min(route.index + 1, route.backups.length);
          }
          yield chunk;
        }
      } catch (error) {
        if (visible && !options.signal?.aborted) throw Object.assign(Error('Stream interrupted after output; automatic replay blocked'), { code: 'FAILOVER_PARTIAL_STREAM' });
        // Thrown middleware errors are terminal in this host; no invented retry loop.
        throw error;
      }
    }
  };
}
export async function apply(ctx, config) {
  const adapter = await import(config?.hostAdapterModuleURL ?? '@deepseek-ai/dsh-llm-pi-ai');
  if (adapter.requestBaseURLVersion !== 1) throw Error('Requires request-base-url core patch v1 for DSH 0.2.1-rc.2; refusing to activate');
  const router = createRouter(config);
  ctx.on('llm-pi-ai/request-base-url', async (options, primary, next) => router.baseURL(options, await next()));
  ctx.on('llm/stream', (options, next) => router.stream(options, next));
}
