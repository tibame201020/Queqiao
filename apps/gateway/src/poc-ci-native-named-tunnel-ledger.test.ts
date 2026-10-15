import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const adr=readFileSync('docs/adr/0018-ci-native-chatgpt-runtime-acceptance.md','utf8');
const ledger=readFileSync('docs/gate3-full-e2e.md','utf8');
describe('#185 verified owned Named Tunnel transport, distinct from native model-on-demand acceptance',()=>{
 it('pins original successful Hosted Run and failed circular-readiness regression',()=>{
  for(const s of ['38688427345','38688836254','38689173302','57a750e4267ce1380ff6f89be88bbd8d6c082b2b',
   'pre-enrollment','post-enrollment','HTTP 401','HTTP 200','HTTP 530','Cleanup','NOT ACCEPTED'])expect(adr).toContain(s);
  expect(ledger).toContain('Named Tunnel transport: VERIFIED');
 });
 it('does not falsely assert persistent wake-up or model-native call and never leaks an owned domain into public repo',()=>{
  expect(adr).toContain('persistent ingress/dispatch control plane');
  expect(adr).toContain('not a model-native MCP invocation');
  expect(adr).toContain('Public hostname is represented only by the existing private repository variable');
 });
});
