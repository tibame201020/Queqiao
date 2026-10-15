import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const adr=readFileSync('docs/adr/0018-ci-native-chatgpt-runtime-acceptance.md','utf8');
const ledger=readFileSync('docs/gate3-full-e2e.md','utf8');
const index=readFileSync('docs/adr/README.md','utf8');
describe('#185 native runtime gate specification',()=>{
 it('makes fixed front door and original same-session tool request necessary, without revoking historical ADR-0017',()=>{
  for(const clause of ['#185','CI ChatGPT session','stable URL','two independent reviewed-main runs','native tool-call','on-demand Lease','Gateway original','NOT ACCEPTED','ADR-0017','NOT_VERIFIED'])expect(adr).toContain(clause);
  expect(index).toContain('0018-ci-native-chatgpt-runtime-acceptance.md');
  expect(ledger).toContain('#185');
 });
 it('records blockers rather than inventing fixed ingress or model invocation',()=>{
  for(const clause of ['trycloudflare.com','poc-gate3-worker-client.ts','session-acceptance.ts','named tunnel','registered ChatGPT custom MCP','original UI observation','No DNS, credential or production publication'])expect(adr).toContain(clause);
 });
});
