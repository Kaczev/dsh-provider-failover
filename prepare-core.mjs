import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=import.meta.dirname;
const runtime=path.join(root,'.runtime');
const specs=[
 ['@deepseek-ai/dsh-agent-loop/lib/index.js', [
 ['\t\tlet firstAttempt = true;','\t\tconst transportRequest = Object.freeze({});\n\t\tlet firstAttempt = true;'],
 ['}, startsRequestSeries, signal);','}, startsRequestSeries, signal, transportRequest);'],
 ['buildRequest(config, preparedCall, tools, position, startsRequestSeries, signal) {','buildRequest(config, preparedCall, tools, position, startsRequestSeries, signal, transportRequest) {'],
 ['\t\t\tsessionId: this.session.id,\n\t\t\tsignal','\t\t\tsessionId: this.session.id,\n\t\t\ttransportRequest,\n\t\t\tsignal']
 ]],
 ['@deepseek-ai/dsh-llm-pi-ai/lib/index.js',[
 ['\t\t\tconst model = this.modelOf(snapshot, options.provider, options.model);','\t\t\tconst originalModel = this.modelOf(snapshot, options.provider, options.model);\n\t\t\tconst baseUrl = this.config.resolveBaseURL ? await this.config.resolveBaseURL(options, originalModel.baseUrl) : originalModel.baseUrl;\n\t\t\tconst model = baseUrl === originalModel.baseUrl ? originalModel : { ...originalModel, baseUrl };'],
 ['\t\tresolveApiKey,\n\t\tauth,','\t\tresolveApiKey,\n\t\tresolveBaseURL: (options, primary) => ctx.waterfall("llm-pi-ai/request-base-url", options, primary, () => Promise.resolve(primary)),\n\t\tauth,'],
 ['\t\t\tconst apiKey = await this.config.resolveApiKey(options.provider, profile);','\t\t\tconst apiKey = await this.config.resolveApiKey(options.provider, profile);\n\t\t\tif (baseUrl !== originalModel.baseUrl && (!profile.apiKeyEnv || !apiKey)) throw new LlmError("request URL override requires explicit API-key provider authentication", "UNSUPPORTED_OPTION");'],
 ['timeoutOf(watchdog.signal, "LLM_STREAM_IDLE_TIMEOUT") !== void 0','(timeoutOf(watchdog.signal, "LLM_STREAM_IDLE_TIMEOUT") ?? timeoutOf({ reason: error }, "LLM_STREAM_IDLE_TIMEOUT")) !== void 0'],
 ['export { Config, PiAiAdapter, apply, inject, name, recordKeyFor, supportedProtocols };','const requestBaseURLVersion = 1;\nexport { Config, PiAiAdapter, apply, inject, name, recordKeyFor, supportedProtocols, requestBaseURLVersion };'],
 ['if (/\\b400\\b|invalid.?request/i.test(message)) return "INVALID_REQUEST";','if (/\\b400\\b|invalid.?request/i.test(message)) return "INVALID_REQUEST";\n\tif (/^408(?:[:\\s]|$)|\\bHTTP(?: status)?[: ]+408\\b/i.test(message)) return "TIMEOUT";']
 ]]
];
const manifest=[];
for(const [rel, changes] of specs){
 const file=path.join(runtime,'node_modules',rel); const saved=path.join(root,'core/original',rel); const before=fs.readFileSync(fs.existsSync(saved)?saved:file,'utf8'); let after=before;
 for(const [a,b] of changes){if(after.split(a).length!==2) throw Error('Patch anchor not unique: '+rel+' '+a); after=after.replace(a,b);}
 const original=path.join(root,'core/original',rel);const patched=path.join(root,'core/patched',rel);
 fs.mkdirSync(path.dirname(original),{recursive:true});fs.mkdirSync(path.dirname(patched),{recursive:true});
 fs.writeFileSync(original,before);fs.writeFileSync(patched,after);fs.writeFileSync(file,after);
 manifest.push({file:rel,originalSha256:crypto.createHash('sha256').update(before).digest('hex'),patchedSha256:crypto.createHash('sha256').update(after).digest('hex')});
}
fs.writeFileSync(path.join(root,'core/manifest.json'),JSON.stringify({version:'0.2.1-rc.2',files:manifest},null,2));
console.log('Patched isolated runtime:',manifest.map(x=>x.file));
