import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, resolveConfig } from '../../.runtime/node_modules/@deepseek-ai/cordis/lib/index.js';
import SettingsForms from '../../.runtime/node_modules/@deepseek-ai/dsh-settings/lib/index.js';
import { Config, apply } from '../../plugin/index.js';
import { updateVolatile } from '../../.runtime/node_modules/@deepseek-ai/cosmokit/lib/index.js';
import { Entry } from '../../.runtime/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js';
// Isolated real SettingsForms with a persistence stub, NOT the Desktop Loader.
const ns = 'kaczev-provider-line-failover', folder = await mkdtemp(join(tmpdir(), 'dsh-backups-settings-'));
const ctx = new Context();
try {
 const runtime = { Config }, entry = { id: ns, options: { id: ns, config: {} }, fiber: { uid: 1, state: 2, runtime, ctx, config: resolveConfig(runtime, {}) } };
 const file = join(folder, 'settings.json');
 ctx.provide('profileContext', { home: folder, name: 'isolated' });
 ctx.provide('loader', { await: async () => {} });
 ctx.provide('configEditor', {
  documentPath: file, entries: () => [entry], configuration: () => [{ entry, inherited: {}, override: entry.options.config }],
  async edit(target, change) {
   const next = change(target.options.config, {}), resolved = resolveConfig(runtime, next);
   await writeFile(file, JSON.stringify(next)); target.options.config = next;
   updateVolatile(target.fiber.config.providers, resolved.providers);
  },
 });
 const settings = new SettingsForms(ctx), view = settings.describe().find(row => row.ns === ns);
 assert.ok(view); console.log('PASS real SettingsForms.describe');
 const value = { enabled: true, backups: ['https://backup.example/v1'] };
 await settings.mutate(ns, [{ op: 'set', path: ['providers', 'fixture'], value }], view.revision);
 assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).providers.fixture, value);
 assert.deepEqual(entry.fiber.config.providers.get().fixture, value);
 console.log('PASS settings.mutate isolated persistence and volatile reference update');
 for (const backups of [['http://unsafe.test'], ['https://a.test?'], ['https://a.test#'], ['https://u:p@a.test'], ['https://a.test', 'https://A.test/']]) {
  await assert.rejects(settings.mutate(ns, [{ op: 'set', path: ['providers', 'fixture'], value: { enabled: true, backups } }]));
 }
 assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).providers.fixture, value);
 console.log('PASS unsafe/duplicate writes rejected without changing file');
 // Calls the installed commit algorithm, not the full Entry.update lifecycle.
 const active = resolveConfig(runtime, { providers: { fixture: value } });
 const ref = active.providers;
 const replacement = { enabled: true, backups: ['https://next.example/v1'] };
 const warnings = [];
 const loaderEntry = {
  options: { id: ns, config: { providers: { fixture: replacement } } },
  fiber: { config: active, runtime, ctx },
  ctx: { logger: { warn: (...args) => warnings.push(args), debug() {} } },
 };
 assert.equal(Entry.prototype._commitVolatile.call(loaderEntry), true);
 assert.equal(active.providers, ref);
 assert.deepEqual(ref.get().fixture, replacement);
 loaderEntry.options.config = { providers: { fixture: { enabled: true, backups: ['http://unsafe.test'] } } };
 assert.equal(Entry.prototype._commitVolatile.call(loaderEntry), true);
 assert.deepEqual(ref.get().fixture, replacement);
 assert.ok(warnings.length);
 console.log('PASS real Loader._commitVolatile preserves reference and rejects invalid candidate (isolated entry, not full lifecycle)');
 await assert.rejects(settings.mutate('other-plugin', [{ op: 'set', path: ['providers'], value: {} }]));
 console.log('PASS missing namespace rejected (not proof of cross-namespace authorization)');
 let configured = false;
 await assert.rejects(apply({ configEditor: { entries: () => [] }, settings: { configure(options) { assert.equal(options.auto, false); configured = true; return () => {}; } }, effect(callback) { callback(); } }, {}), /PiAiAdapter module unavailable/);
 assert.ok(configured); console.log('PASS missing active adapter refuses failover activation');
} finally { await ctx.fiber.dispose(); await rm(folder, { recursive: true, force: true }); }
