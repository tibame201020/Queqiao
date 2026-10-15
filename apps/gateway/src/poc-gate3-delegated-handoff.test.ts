import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {makeGate3Artifact,validateGate3Output} from '@queqiao/browser-harness-runtime/gate3-content';
import {createGate3Trace} from '@queqiao/browser-harness-runtime/gate3-trace';
import {prepareGate3DelegatedHandoff, verifyGate3DelegatedHandoff} from './poc-gate3-delegated-handoff.js';
const h=(s:string)=>createHash('sha256').update(s).digest('hex');
const date='2026-10-16',c='12345',w='12346',revision='a'.repeat(40),lease='11111111-1111-4111-8111-111111111111';
const e={controllerRunId:c,controllerAttempt:'1',workerRunId:w,workerAttempt:'1',sourceRevision:revision,date};
const fields=validateGate3Output(JSON.stringify({concept:'測試驅動開發要求先描述預期行為，再以失敗測試確認實作缺口與可驗證標準。',verification:'先讓測試失敗，再完成最小實作使測試通過，最後重構並再次確認回歸測試。',limitation:'這只是隔離的內容產線測試，不是新聞、投資研究或任何正式發表的文章。'}));
const base=makeGate3Artifact({runId:w,runAttempt:'1',date,fields,authenticated:true,userTurn:true,assistantTurn:true,generationFinished:true});
const source={...base,trace:createGate3Trace(base)};
const proof={schema:'queqiao.gate3.controller-complete.v1',controllerRunId:c,controllerAttempt:'1',workerRunId:w,environmentId:'gha_worker_test',leaseId:lease,date,
 leaseState:'disposed',workerConclusion:'cancelled',taskId:source.trace.taskId,logicalKey:source.trace.logicalKey,path:source.path,articleSha256:source.trace.articleSha256,contentVerified:true,connector:'not_observed',targetCi:'not_observed'};
const archived={schema:'queqiao.gate3.hosted-audit.v1',controllerRunId:c,controllerAttempt:'1',workerRunId:w,environmentId:proof.environmentId,leaseId:lease,date,sourceRevision:revision,
 repository:'tibame201020/Queqiao',verdict:'candidate_for_independent_review',workerProof:{schema:'queqiao.gate3.worker-content.v1',controllerRunId:c,controllerAttempt:'1',workerRunId:w,taskId:source.trace.taskId,logicalKey:source.trace.logicalKey,articleSha256:source.trace.articleSha256,date,path:source.path,contentVerified:true},receipt:{eventId:'22222222-2222-4222-8222-222222222222'}};
const head={schema:'queqiao.gate3.hosted-github-audit.v1',controllerRunId:c,controllerAttempt:'1',workerRunId:w,environmentId:proof.environmentId,leaseId:lease,date,sourceRevision:revision,
 repository:'tibame201020/Queqiao',verdict:'candidate_for_independent_review',workerAuditSha256:h(JSON.stringify(archived)+'\n'),receipt:{eventId:'33333333-3333-4333-8333-333333333333'}};
const a=JSON.stringify(archived)+'\n',b=JSON.stringify(head)+'\n';
describe('#124 joined G3.4/3.5 independent exact Worker-to-ChatGPT handoff',()=>{
 it('releases only verified synthetic Worker bytes after disposed lease and retains exact archived provenance digests, never claims publication',()=>{
  const result=prepareGate3DelegatedHandoff(source,proof,a,b,e);
  expect(result).toMatchObject({schema:'queqiao.gate3.delegated-handoff.v1',controllerRunId:c,workerRunId:w,date,leaseState:'disposed',workerConclusion:'cancelled',
   sourceArtifact:source,articleSha256:source.trace.articleSha256,workerAuditSha256:h(a),githubAuditSha256:h(b),publication:'not_observed',fullGatePassed:false});
  expect(verifyGate3DelegatedHandoff(result,proof,a,b,e)).toEqual(result);
  expect(JSON.stringify(result)).not.toContain('privateToken');
 });
 it('rejects fabricated content, run, non-disposed lease or non-matching audit linkage',()=>{
  for(const [s,p,wa,ha,ex] of [
   [{...source,article:source.article+'foo'},proof,a,b,e],[source,{...proof,leaseState:'ready'},a,b,e],
   [source,{...proof,articleSha256:'f'.repeat(64)},a,b,e],[source,proof,a,b,{...e,controllerRunId:'888'}],
   [source,proof,a,JSON.stringify({...head,workerAuditSha256:'f'.repeat(64)}),e],
   [source,proof,JSON.stringify({...archived,leaseId:'other'}),b,e],
  ] as const)expect(()=>prepareGate3DelegatedHandoff(s,p,wa,ha,ex)).toThrow();
 });
 it('rejects altered handoff payload even when its article hash is retained',()=>{
  const result=prepareGate3DelegatedHandoff(source,proof,a,b,e);
  for(const bad of [{...result,articleSha256:'f'.repeat(64)},{...result,sourceArtifact:{...source,article:source.article+' '}},
   {...result,token:'privateToken'},{...result,publication:'success'},{...result,leaseState:'running'}])
   expect(()=>verifyGate3DelegatedHandoff(bad,proof,a,b,e)).toThrow();
 });
});
