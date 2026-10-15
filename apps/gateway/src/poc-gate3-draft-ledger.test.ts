import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const doc=readFileSync('docs/gate3-full-e2e.md','utf8');
describe('#124 G3.4 operator-assisted target witness ledger',()=>{
 it('retains actual branch, only added file, target CI and the explicit no-Hosted conclusion',()=>{
  for(const v of ['signal-notes/pull/3','38668658061','a18c244c5b071b833757c5bb4c0e5859a38f8bf6',
   '74ecd4261e729e3edb0077f5aae5dfa961f05f42',
   'fc47987126c1261c5afee525a0687563f674c203cd1a95d7433d19d8bd1f5674',
   'operator_assisted_target_consistent','hostedWriteObserved=false','fullGatePassed=false',
   'NOT Hosted G3.4 PASS'])expect(doc).toContain(v);
  expect(doc).not.toContain('G3.4 FULL PASS');
 });
});
