// Opt-in live probe. Never reads the user's credential store.
const { FAILOVER_PROBE_KEY: key, FAILOVER_PROBE_URL: base, FAILOVER_PROBE_MODEL: model, FAILOVER_PROBE_CONFIRM: confirm } = process.env;
if (confirm !== 'yes' || !key || !base || !model) throw Error('Set FAILOVER_PROBE_CONFIRM=yes, FAILOVER_PROBE_KEY, FAILOVER_PROBE_URL and FAILOVER_PROBE_MODEL; this sends a billable real request.');
const url = new URL(base);
if (url.protocol !== 'https:' || url.username || url.password || base.includes('?') || base.includes('#')) throw Error('Probe requires a safe HTTPS base URL');
const start = Date.now();
try {
 const response = await fetch(base.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{role:'user',content:'Reply OK only.'}], max_completion_tokens: 16, stream: false }) });
 console.log(JSON.stringify({ status: response.status, elapsedMs: Date.now() - start }));
 await response.body?.cancel();
} catch (error) { console.log(JSON.stringify({ errorName: error.name, errorCode: error.cause?.code, elapsedMs: Date.now() - start })); process.exitCode = 1; }
