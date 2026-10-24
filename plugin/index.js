// No fetch monkeypatching, provider re-registration, or persisted settings changes.
import z from '@deepseek-ai/schemastery';

export function normalizeBackup(value) {
  const raw = value.trim();
  if (!/^https:\/\//i.test(raw)) throw Error('地址必须使用 https://');
  const url = new URL(raw);
  if (url.username || url.password || raw.includes('@') || raw.includes('?') || raw.includes('#')) throw Error('地址不能包含账号、查询参数或锚点');
  return url.href.replace(/\/+$/, '');
}
const ProviderConfig = z.transform(z.object({
  enabled: z.boolean().default(false),
  backups: z.array(z.string()).default([]),
}), value => {
  if (value.backups.length > 2) throw Error('最多添加两条备用地址');
  const backups = value.backups.map(normalizeBackup);
  if (new Set(backups).size !== backups.length) throw Error('备用地址重复');
  if (value.enabled && !backups.length) throw Error('启用至少需要一条备用地址');
  return { enabled: value.enabled, backups };
}, true);
export const Config = z.object({
  providers: z.dict(ProviderConfig).default({}).volatile(),
});

export const name = 'provider-line-failover';
export const inject = ['settings', 'configEditor'];
export function validate(config = {}) {
  const providers = Object.create(null);
  const source = config.providers;
  const entries = typeof source?.get === 'function' ? source.get() : source;
  for (const [id, entry] of Object.entries(entries ?? {})) {
    if (!entry.enabled) continue;
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
  let providers = validate(config);
  const requests = new WeakMap();
  function state(options) {
    const key = options.transportRequest;
    if (!key || typeof key !== 'object' || options.purpose) return;
    let value = requests.get(key);
    let route = value?.get(options.provider);
    if (route) return route;
    const entry = providers[options.provider];
    if (!entry) return;
    if (!value) { value = new Map(); requests.set(key, value); }
    route = { index: 0, backups: entry.backups }; value.set(options.provider, route);
    return route;
  }
  return {
    reload(nextConfig) { providers = validate(nextConfig); },
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
import { installTransport } from './transport.js';
export async function apply(ctx, config) {
  ctx.effect(() => ctx.settings.configure({ auto: false }));
  const entries = ctx.configEditor.entries().filter(entry => entry.options.name === '@deepseek-ai/dsh-llm-pi-ai');
  const classes = [...new Set(entries.map(entry => entry.moduleNamespace?.PiAiAdapter))];
  if (!classes.length || classes.some(value => typeof value !== 'function')) throw Error('Active rc3 PiAiAdapter module unavailable; failover not installed');
  const turns = new Map();
  ctx.on('agent/request', async (payload, next) => {
    const id = String(payload.agent.session.id);
    if (turns.get(id)?.turn !== payload.turn) turns.set(id, { turn: payload.turn, routes: new Map() });
    return next();
  });
  ctx.on('agent/disposed', ({ agent }) => turns.delete(String(agent.session.id)));
  for (const Adapter of classes) ctx.effect(() => installTransport(Adapter, () => config.providers.get(), turns));
}
