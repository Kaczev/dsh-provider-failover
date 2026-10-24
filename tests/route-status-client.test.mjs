import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('header renders all six labels, exact hover URL, keyboard dismissal and disposes subscription', () => {
 let definition, state, open = false, source, effects, stateIndex;
 class EventSource {
  constructor(url) { this.url = url; source = this; }
  close() { this.closed = true; }
 }
 const React = {
  createElement: (type, props, ...children) => ({type,props,children}),
  useState(initial) {
   const index = stateIndex++;
   const value = index === 0 ? state : index === 1 ? open : initial;
   return [value, next => { if (index === 0) state = next; if (index === 1) open = typeof next === 'function' ? next(open) : next; }];
  },
  useRef: () => ({current:{getBoundingClientRect: () => ({left:600,bottom:80})}}),
  useId: () => 'fixture-tooltip', useEffect: callback => effects.push(callback),
 };
 const window = {innerWidth:1600,addEventListener(){},removeEventListener(){},__ModuleLoader__:{load(value){definition=value;}}};
 vm.runInNewContext(fs.readFileSync('plugin/client.js','utf8'), {window,URL,EventSource});
 const client = definition.factory(() => React);
 const render = () => { stateIndex = 0; effects = []; return client.RouteStatus({sessionId:'session/a'}); };
 for (const index of [0,1,2]) for (const phase of ['active','connecting']) {
  state = {index,phase,url:'https://fixture.test/v1'}; open = false;
  const view = render(), button = view.children[1];
  const css = view.children[0].children[0];
  const design = fs.readFileSync('design/route-status-ui.html', 'utf8');
  for (const color of ['#a5a5ab','#80b99a','#d7b573','#93b0ff','#455576','#242426','#414144','#252527','#ececef']) {
   assert.ok(design.includes(color), 'expected palette in canonical design: ' + color);
   assert.ok(css.includes(color), 'widget must preserve approved palette: ' + color);
  }
  const label = (phase === 'connecting' ? '连接' : '') + (index ? '备用地址'+index : '默认地址') + (phase === 'connecting' ? '……' : '');
  assert.equal(button.children[1].children[0], label);
   const spinner = css.match(/\.plf-route-label\.connecting \.plf-route-dot\{([^}]+)\}/)[1];
   for (const rule of ['display:block','box-sizing:border-box','flex:0 0 12px','width:12px','height:12px','aspect-ratio:1','border-radius:50%','transform-origin:50% 50%','padding:0','margin:0']) {
    assert.ok(spinner.split(';').includes(rule), 'spinner geometry: ' + rule);
    assert.ok(design.includes(rule), 'canonical spinner geometry: ' + rule);
   }
  button.props.onFocus(); assert.equal(open,true);
  const tooltip = render().children[2];
  assert.equal(tooltip.props.role,'tooltip'); assert.equal(tooltip.children[1].children[0],state.url);
  button.props.onKeyDown({key:'Escape'}); assert.equal(open,false);
 }
 render(); const dispose = effects[0]();
 assert.equal(source.url,'/api/provider-line-failover/status?sessionId=session%2Fa');
 source.onmessage({data:JSON.stringify({phase:'active',index:2,url:'https://backup.test'})});
 assert.equal(state.index,2);
 source.onerror(); assert.equal(state,null); assert.equal(render(),null);
 dispose(); assert.equal(source.closed,true);
});
