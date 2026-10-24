window.__ModuleLoader__.load({
 id: 'dsh-provider-failover',
 factory(require) {
  const React = require('react'), h = React.createElement;
  const NS = 'kaczev-provider-line-failover';
  const empty = () => ({ enabled: false, backups: [] });
  function normalize(value) {
   const raw = value.trim();
   if (!/^https:\/\//i.test(raw)) throw Error('地址必须使用 https://');
   let url; try { url = new URL(raw); } catch { throw Error('请输入有效的 https:// 地址'); }
   if (url.username || url.password || raw.includes('@')) throw Error('地址不能包含账号或密码');
   if (raw.includes('?') || raw.includes('#')) throw Error('地址不能包含查询参数或锚点');
   return url.href.replace(/\/+$/, '');
  }
  function validateDraft(draft, primary) {
   let main; try { main = normalize(primary || ''); } catch {}
   const seen = new Set(), values = [];
   const errors = draft.backups.map(value => {
    if (!value.trim()) return '';
    try {
     const canonical = normalize(value);
     if (canonical === main) return '与主地址相同，无需填写';
     if (seen.has(canonical)) return '与其他备用地址重复';
     seen.add(canonical); values.push(canonical); return '';
    } catch (error) { return error.message; }
   });
   return { errors, reason: draft.backups.length > 2 ? '最多添加两条备用地址' : errors.find(Boolean) || (draft.enabled && !values.length ? '启用故障切换至少需要一条地址' : ''), value: { enabled: draft.enabled, backups: values } };
  }
  function unwrapSettings(response) {
   if (response?.ok !== true) throw Error(response?.error?.message || '设置请求失败');
   return response.value;
  }
  function draftConflicts(previous, next, id) {
   if (!previous) return true;
   const entry = view => view.view.value?.providers?.[id] ?? { enabled: false, backups: [] };
   const provider = view => view.providers.find(item => item.id === id);
   return JSON.stringify(entry(previous)) !== JSON.stringify(entry(next)) ||
    JSON.stringify(provider(previous)) !== JSON.stringify(provider(next)) || previous.writable !== next.writable;
  }
  function Page({ remote, useRemoteAccess }) {
   const canWrite = useRemoteAccess('settings.mutate');
   const [snapshot, setSnapshot] = React.useState(null), [provider, setProvider] = React.useState('');
   const [draft, setDraft] = React.useState(empty), [busy, setBusy] = React.useState(false);
   const [notice, setNotice] = React.useState('正在读取备用地址…'), [stale, setStale] = React.useState(false);
   const dirtyRef = React.useRef(false), saving = React.useRef(false), generation = React.useRef(0);
   const providerRef = React.useRef(''), snapshotRef = React.useRef(null);
   const stored = (view, id) => { const entry = view?.value?.providers?.[id]; return { enabled: entry?.enabled === true, backups: [...(entry?.backups ?? [])] }; };
   const load = React.useCallback(async (discard = false) => {
    const ticket = ++generation.current;
    try {
     const result = unwrapSettings(await remote.settings.describe());
     if (ticket !== generation.current) return;
     const view = result.namespaces.find(item => item.ns === NS || item.ns.endsWith(':' + NS));
     const llm = result.namespaces.find(item => item.ns === 'llm-pi-ai' || item.ns.endsWith(':llm-pi-ai'));
     if (!view) throw Error('未找到备用地址插件设置');
     const providers = Object.entries(llm?.value?.providers ?? {}).map(([id, value]) => ({ id, label: value.displayName || id, primary: value.baseURL || '' }));
     const nextSnapshot = { view, providers, writable: result.writable === true };
     if (dirtyRef.current && !discard) {
      if (draftConflicts(snapshotRef.current, nextSnapshot, providerRef.current)) {
       setStale(true); setNotice('当前供应商的设置已在其他位置更新，请重新加载后再保存。');
      } else {
       snapshotRef.current = nextSnapshot; setSnapshot(nextSnapshot);
      }
      return;
     }
     const id = providers.some(item => item.id === providerRef.current) ? providerRef.current : providers[0]?.id || '';
     providerRef.current = id; setProvider(id); setDraft(stored(view, id));
     snapshotRef.current = nextSnapshot; setSnapshot(nextSnapshot); setStale(false); dirtyRef.current = false;
     setNotice(providers.length ? '' : '暂无已配置的供应商，请先在模型设置中添加。');
    } catch (error) { if (ticket === generation.current) { setStale(true); setNotice(error.message || '读取备用地址失败'); } }
   }, [remote]);
   React.useEffect(() => { load(); const dispose = remote.$on('settings/document-updated', () => { if (!saving.current) load(); }); return () => { generation.current++; dispose(); }; }, [load, remote]);
   const original = stored(snapshot?.view, provider);
   const dirty = JSON.stringify(draft) !== JSON.stringify(original); dirtyRef.current = dirty;
   const primary = snapshot?.providers.find(item => item.id === provider)?.primary || '';
   const checked = validateDraft(draft, primary), disabled = busy || !snapshot?.writable || !canWrite || stale || !provider;
   const change = next => { setDraft(next); setNotice(''); };
   const move = (index, offset) => { const backups = [...draft.backups]; [backups[index], backups[index + offset]] = [backups[index + offset], backups[index]]; change({ ...draft, backups }); };
   async function save() {
    if (disabled || !dirty || checked.reason) return;
    saving.current = true; setBusy(true); setNotice('正在保存…');
    try {
     const next = unwrapSettings(await remote.settings.mutate(snapshot.view.ns, [{ op: 'set', path: ['providers', provider], value: checked.value }], snapshot.view.revision));
     snapshotRef.current = { ...snapshotRef.current, view: next }; setSnapshot(snapshotRef.current); setDraft(stored(next, provider)); dirtyRef.current = false; setNotice('已保存');
    } catch { setStale(true); setNotice('保存失败或版本冲突；草稿已保留，请重新加载后重试。'); }
    finally { saving.current = false; setBusy(false); }
   }
   const action = (label, text, callback, off) => h('button', { type: 'button', className: 'icon', title: label, 'aria-label': label, disabled: disabled || off, onClick: callback }, text);
   return h('main', { className: 'plf-settings', 'data-testid': 'backup-address-settings' },
    h('style', null, CSS), h('h1', null, '备用地址'),
    h('div', { className: 'field' }, h('label', { className: 'label', htmlFor: 'plf-provider' }, '供应商'),
     h('select', { className: 'select', id: 'plf-provider', value: provider, disabled: busy || !snapshot, onChange: event => {
      if (dirty && !window.confirm('当前修改尚未保存，是否放弃？')) return;
      const id = event.target.value; providerRef.current = id; setProvider(id); setDraft(stored(snapshot.view, id)); setNotice('');
     } }, snapshot?.providers.map(item => h('option', { key: item.id, value: item.id }, item.label)))),
    h('div', { className: 'field' }, h('span', { className: 'label' }, '主地址'), h('span', { className: 'primary' }, primary || '未配置自定义主地址')),
    h('section', { className: 'block' }, h('div', { className: 'head' }, h('h2', null, '备用地址'),
     h('label', { className: 'toggle' }, '启用', h('input', { type: 'checkbox', role: 'switch', 'aria-checked': draft.enabled, checked: draft.enabled, disabled, onChange: event => change({ ...draft, enabled: event.target.checked }) }), h('span', { className: 'track', 'aria-hidden': true }))),
     [0, 1].map(index => h('div', { className: 'field', key: index },
      h('label', { className: 'label', htmlFor: 'plf-backup-' + index }, '备线 ' + (index + 1)),
      h('div', null, h('input', { id: 'plf-backup-' + index, value: draft.backups[index] || '', disabled, placeholder: '留空表示不使用此线路', 'aria-label': '备用地址 ' + (index + 1), 'aria-invalid': !!checked.errors[index],
       onChange: event => { const backups = [draft.backups[0] || '', draft.backups[1] || '']; backups[index] = event.target.value; change({ ...draft, backups }); } }),
       h('p', { className: 'error' }, checked.errors[index]))))),
    h('footer', { className: 'footer' }, h('span', { className: 'status', role: 'status', 'aria-live': 'polite' }, notice || ((!snapshot?.writable || !canWrite) && snapshot ? '当前设置为只读' : checked.reason || (dirty ? '未保存' : ''))),
     h('button', { className: 'cancel', type: 'button', disabled: busy || !dirty, onClick: () => { setDraft(original); setNotice(''); } }, '取消'),
     h('button', { className: 'save', type: 'button', disabled: disabled || !dirty || !!checked.reason, onClick: save }, busy ? '保存中…' : '保存')),
    stale ? h('button', { type: 'button', className: 'text', disabled: busy, onClick: () => { if (!dirty || window.confirm('重新加载会放弃未保存的修改，是否继续？')) load(true); } }, '重新加载') : null);
  }
  const CSS = `.plf-settings button,.plf-settings input,.plf-settings select{font:inherit}.plf-settings button{cursor:pointer}.plf-settings button:disabled{cursor:default;opacity:.4}.plf-settings button:focus-visible,.plf-settings input:focus-visible,.plf-settings select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.plf-settings{padding:32px 40px;min-width:0;container-type:inline-size}.plf-settings h1{font-size:18px;font-weight:500;margin:0 0 24px}.plf-settings .field{display:grid;grid-template-columns:100px minmax(0,1fr);gap:12px;align-items:center;margin-bottom:18px}.plf-settings .label{color:var(--dsw-alias-label-secondary);font-size:13px}.plf-settings .select,.plf-settings input{width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:10px 12px}.plf-settings .primary{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:13px}.plf-settings .block{margin-top:26px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:22px}.plf-settings .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.plf-settings .head h2{font-size:14px;font-weight:500;margin:0}.plf-settings .toggle{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}.plf-settings .toggle input{position:absolute;opacity:0;width:1px;height:1px}.plf-settings .track{width:34px;height:20px;border-radius:20px;background:var(--dsw-alias-border-l2);border:1px solid var(--dsw-alias-border-l1);position:relative}.plf-settings .track:after{content:"";position:absolute;width:14px;height:14px;top:2px;left:2px;border-radius:50%;background:#fff;transition:transform .15s}.plf-settings .toggle input:checked+.track{background:var(--dsw-alias-brand-primary)}.plf-settings .toggle input:checked+.track:after{transform:translateX(14px)}.plf-settings .toggle input:focus-visible+.track{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.plf-settings .row{display:grid;grid-template-columns:20px minmax(0,1fr) 96px;gap:10px;align-items:start;margin-bottom:12px}.plf-settings .number{padding-top:10px;color:var(--dsw-alias-label-secondary);font-size:12px}.plf-settings .actions{display:flex;gap:2px;padding-top:6px}.plf-settings .icon{border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;width:30px;height:30px}.plf-settings .icon:hover,.plf-settings .text:hover{background:#ffffff0d;color:var(--dsw-alias-label-primary)}.plf-settings .error{margin:5px 2px 0;color:var(--dsw-alias-state-error-primary);font-size:12px}.plf-settings .invalid{border-color:var(--dsw-alias-state-error-primary)}.plf-settings .text{border:0;background:none;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:6px 12px}.plf-settings .add{margin-left:20px}.plf-settings .empty{color:var(--dsw-alias-label-secondary);padding:12px 0 20px;font-size:13px}.plf-settings .footer{display:flex;align-items:center;gap:10px;border-top:1px solid var(--dsw-alias-border-l1);margin-top:28px;padding-top:20px}.plf-settings .status{flex:1;color:var(--dsw-alias-label-secondary);font-size:12px}.plf-settings .status.success{color:var(--dsw-alias-state-success-primary)}.plf-settings .save{padding:7px 20px;border:1px solid transparent;border-radius:10px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}.plf-settings .cancel{padding:7px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary)}@container(max-width:460px){.field{grid-template-columns:1fr;gap:6px}.plf-settings .row{grid-template-columns:16px minmax(0,1fr);gap:6px}.plf-settings .actions{grid-column:2;padding-top:0;justify-content:flex-end;margin-top:-8px}.plf-settings .add{margin-left:10px}}@media(max-width:700px){.plf-settings{padding:26px 20px}}

.plf-settings{color:var(--dsw-alias-label-primary);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;padding:32px 40px;min-width:0;container-type:inline-size}.plf-settings *{box-sizing:border-box}.plf-settings input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}
/* native-control-alignment */
.plf-settings .row input:focus,.plf-settings .select:focus{outline:none;outline-offset:0;box-shadow:none;border-color:var(--dsw-alias-brand-primary)}
.plf-settings .select,.plf-settings .row input{border-radius:10px;padding:6px 10px;min-height:32px;line-height:20px;font-size:14px}
.plf-settings .field{margin-bottom:16px}.plf-settings .label,.plf-settings .primary{font-size:13px}
.plf-settings .block{margin-top:20px;padding-top:16px}.plf-settings .head{margin-bottom:14px}
.plf-settings .track{display:block;flex:none;width:36px;height:20px;border:0;border-radius:999px;background:var(--dsw-alias-border-l2)}
.plf-settings .track:after{width:16px;height:16px;top:2px;left:2px;background:var(--dsw-alias-label-secondary);transition:transform .15s,background .15s}
.plf-settings .toggle input:checked+.track{background:var(--dsw-alias-label-primary)}
.plf-settings .toggle input:checked+.track:after{transform:translateX(16px);background:var(--dsw-alias-bg-layer-2)}
.plf-settings .toggle:has(input:disabled){cursor:default;opacity:.4}.plf-settings .toggle input:disabled+.track{opacity:1}
.plf-settings .row{gap:8px;margin-bottom:10px}.plf-settings .icon{border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px}
.plf-settings .footer{margin-top:20px;padding-top:16px}.plf-settings .cancel,.plf-settings .save{border-radius:10px;padding:6px 16px;min-height:32px}
.plf-settings .save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}`;
  return { inject: ['slots', 'remote', 'remote.settings'], normalize, validateDraft, unwrapSettings, draftConflicts, apply(ctx) {
   ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: NS, order: 25, label: '备用地址' }, props => h(Page, { ...props, remote: ctx.remote })));
  } };
 },
});
