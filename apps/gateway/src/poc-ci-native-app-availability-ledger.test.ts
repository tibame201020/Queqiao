import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const adr=readFileSync('docs/adr/0018-ci-native-chatgpt-runtime-acceptance.md','utf8');
const ledger=readFileSync('docs/gate3-full-e2e.md','utf8');
describe('#185 corrected registered name CI Hosted original evidence and product surface gate',()=>{
 it('pins the actual signed source, run, immutable original artifact digest and fail-closed result',()=>{
  for(const v of ['38691502119','081fbf69e0397c7aaf9818319a2c2eb87cfc6fea','11952321003',
   'a064b476ce91ab45722d2d15e0ea8752bb28b44ab5780aa992ff903b8621c16f',
   'controlCandidate=visible','candidate=not_observed','nativeToolCallObserved=false','NOT ACCEPTED'])expect(adr).toContain(v);
 });
 it('requires web-surface availability evidence and forbids false native tool proof from registered source alone',()=>{
  expect(adr).toContain('Web-surface availability');
  expect(adr).toContain('plugin creator metadata is not a native tool-call');
  expect(adr).toContain('no more selector trials');
  expect(ledger).toContain('Registered-name Hosted preflight: NOT OBSERVED');
 });
});
