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
 it('preserves both original read-only hosted UI proofs without promoting visibility to tool provenance',()=>{
  for(const x of ['38686156534','38687047541','11949941728','11950597494',
   '26ec2533043baaa6c26b69c655ebdd382454d4508d097306b203a2e53dd4d936',
   '3c78fd211c71364ccf5720b0e1384275d99b661d5e1d110b51b8bad245f339b7',
   'controlCandidate=visible','candidate=not_observed','nativeToolCallObserved=false','NOT ACCEPTED'])expect(adr).toContain(x);
  expect(ledger).toContain('Queqiao candidate NOT OBSERVED');
 });
});
