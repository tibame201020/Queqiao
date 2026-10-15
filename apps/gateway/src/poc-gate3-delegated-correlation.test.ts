import {describe,expect,it} from 'vitest';
import {assessGate3DelegatedCorrelation} from './poc-gate3-delegated-correlation.js';
const date='2026-10-16';
const hash='a'.repeat(64),commit='b'.repeat(40);
const worker={schema:'queqiao.gate3.worker-content.v1',controllerRunId:'123',controllerAttempt:'1',workerRunId:'456',taskId:'gate3-456-1',logicalKey:`gate3/synthetic-${date}`,articleSha256:hash,date,path:`src/content/posts/gate3-synthetic-${date}/index.md`,contentVerified:true};
const target={schema:'queqiao.gate3.target-readback.v1',result:'operator_assisted_target_consistent',headSha:commit,prNumber:7,articleSha256:hash,hostedWriteObserved:false,fullGatePassed:false};
const expected={controllerRunId:'123',controllerAttempt:'1',workerRunId:'456',date};
describe('#124 ADR-0017 ChatGPT-delegated G3.4 cross-provider handoff',()=>{
 it('correlates immutable Worker and GitHub state but never invents native App provenance or Gateway write',()=>{
  expect(assessGate3DelegatedCorrelation(worker,target,expected)).toEqual({
   schema:'queqiao.gate3.delegated-correlation.v1',candidate:'hash_and_task_consistent',
   taskId:'gate3-456-1',logicalKey:`gate3/synthetic-${date}`,articleSha256:hash,targetHeadSha:commit,prNumber:7,
   nativeAppExecution:'not_established_by_hash_correlation',gatewayWriteObserved:false,gatePassed:false,
  });
 });
 it('rejects different task, date, original Worker hash, destination article hash or unconfirmed target',()=>{
  const changes=[
   [{...worker,workerRunId:'999'},target,expected],
   [{...worker,taskId:'gate3-999-1'},target,expected],
   [{...worker,date:'2026-10-15'},target,expected],
   [{...worker,articleSha256:'0'.repeat(64)},target,expected],
   [worker,{...target,articleSha256:'0'.repeat(64)},expected],
   [worker,{...target,result:'not_observed'},expected],
   [worker,{...target,hostedWriteObserved:true},expected],
   [worker,target,{...expected,controllerRunId:'999'}],
   [worker,target,{...expected,date:'2026-10-15'}],
  ] as const;
  for(const [w,t,e] of changes)expect(()=>assessGate3DelegatedCorrelation(w,t,e)).toThrow('G34_DELEGATED_CORRELATION_INVALID');
 });
 it('rejects caller-added proof flags or private fields rather than upgrading a pure consistency check',()=>{
  for(const altered of [{...worker,principal:'private'}, {...worker,connector:'pass'}, {...worker,contentVerified:'true'}])
   expect(()=>assessGate3DelegatedCorrelation(altered,target,expected)).toThrow();
  for(const altered of [{...target,appExecuted:true},{...target,gatePassed:true},{...target,token:'private'}])
   expect(()=>assessGate3DelegatedCorrelation(worker,altered,expected)).toThrow();
 });
});
