import {describe,it,expect} from 'vitest';
import {assessRestrictedDraftReadback} from './poc-gate3-draft-target.js';
const expected={repository:'tibame201020/signal-notes',base:'main',branch:'gate3/synthetic-2026-10-15',
 path:'src/content/posts/gate3-synthetic-2026-10-15/index.md',
 articleSha256:'fc47987126c1261c5afee525a0687563f674c203cd1a95d7433d19d8bd1f5674',
 baseSha:'74ecd4261e729e3edb0077f5aae5dfa961f05f42'};
const observed={repository:expected.repository,base:expected.base,branch:expected.branch,branchSha:'a18c244c5b071b833757c5bb4c0e5859a38f8bf6',
 commit:{sha:'a18c244c5b071b833757c5bb4c0e5859a38f8bf6',parents:[expected.baseSha],changedFiles:[{path:expected.path,status:'added'}]},
 file:{path:expected.path,blobSha:'fb27faf3ce4c0c48283f50016306fb7ec52ac9b1',articleSha256:expected.articleSha256,draft:true},
 pr:{number:3,state:'open',draft:true,head:expected.branch,base:'main',headSha:'a18c244c5b071b833757c5bb4c0e5859a38f8bf6',changedFiles:1,files:[expected.path]},
 checks:[{name:'content',status:'completed',conclusion:'success',headSha:'a18c244c5b071b833757c5bb4c0e5859a38f8bf6'}]};
describe('#124 G3.4 target independently read-back acceptance boundary',()=>{
 it('classifies only exact isolated target draft and exact-commit content CI as operator-assisted witness, never Hosted G3.4 PASS',()=>{
  expect(assessRestrictedDraftReadback(expected,observed)).toEqual({schema:'queqiao.gate3.target-readback.v1',
   result:'operator_assisted_target_consistent',headSha:observed.branchSha,prNumber:3,
   articleSha256:expected.articleSha256,hostedWriteObserved:false,fullGatePassed:false});
 });
 it('rejects unrelated, extra or mutated commit changes and branch/base mismatches',()=>{
  for(const bad of [
   {...observed,branch:'main'}, {...observed,branchSha:expected.baseSha},
   {...observed,commit:{...observed.commit,parents:[]}},
   {...observed,commit:{...observed.commit,changedFiles:[...observed.commit.changedFiles,{path:'index.md',status:'modified'}]}},
   {...observed,commit:{...observed.commit,changedFiles:[{path:expected.path,status:'modified'}]}},
   {...observed,file:{...observed.file,articleSha256:'0'.repeat(64)}},
   {...observed,file:{...observed.file,draft:false}},
  ])expect(()=>assessRestrictedDraftReadback(expected,bad)).toThrow();
 });
 it('requires one open Draft PR at the correct commit and successful content check on that same commit',()=>{
  for(const bad of [
   {...observed,pr:{...observed.pr,draft:false}},
   {...observed,pr:{...observed.pr,state:'closed'}},
   {...observed,pr:{...observed.pr,headSha:expected.baseSha}},
   {...observed,pr:{...observed.pr,base:'other'}},
   {...observed,pr:{...observed.pr,files:['unrelated.md']}},
   {...observed,checks:[]},
   {...observed,checks:[{...observed.checks[0]!,status:'in_progress'}]},
   {...observed,checks:[{...observed.checks[0]!,conclusion:'skipped'}]},
   {...observed,checks:[{...observed.checks[0]!,headSha:expected.baseSha}]},
  ])expect(()=>assessRestrictedDraftReadback(expected,bad)).toThrow();
 });
 it('rejects caller-supplied provenance inflation or extra record fields',()=>{
  expect(()=>assessRestrictedDraftReadback(expected,{...observed,fullGatePassed:true})).toThrow();
  expect(()=>assessRestrictedDraftReadback(expected,{...observed,pr:{...observed.pr,merged:true}})).toThrow();
 });
});
