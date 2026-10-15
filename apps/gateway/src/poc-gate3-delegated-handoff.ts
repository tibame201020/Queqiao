import {createHash} from 'node:crypto';
import {completeGate3WorkerEvidence} from './poc-gate3-worker-completion.js';
import {prepareGate3DraftPlan} from './poc-gate3-draft-contract.js';
const h=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const obj=(r:unknown):r is Record<string,any>=>!!r&&typeof r==='object'&&!Array.isArray(r);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const fail=():never=>{throw Error('G345_DELEGATED_HANDOFF_INVALID');};
export type HandoffExpected={controllerRunId:string;controllerAttempt:string;workerRunId:string;workerAttempt:'1';sourceRevision:string;date:string};
/** Constructs the PUBLIC synthetic handoff only from the original validated Worker
 * artifact and the post-disposal controller/Gateway audit records. It does not attest
 * external App action; a second job separately verifies both archived original events.
 */
export function prepareGate3DelegatedHandoff(source:unknown,completed:unknown,workerArchiveRaw:string,githubArchiveRaw:string,e:HandoffExpected){
 let w:unknown,g:unknown;
 try{w=JSON.parse(workerArchiveRaw);g=JSON.parse(githubArchiveRaw);}catch{return fail();}
 if(!obj(w)||!obj(g)||!obj(w.workerProof)||!obj(w.receipt)||!obj(g.receipt)||!obj(completed)||
  !/^[a-f0-9]{40}$/.test(e.sourceRevision)||
  w.schema!=='queqiao.gate3.hosted-audit.v1'||g.schema!=='queqiao.gate3.hosted-github-audit.v1'||
  w.verdict!=='candidate_for_independent_review'||g.verdict!=='candidate_for_independent_review'||
  w.sourceRevision!==e.sourceRevision||g.sourceRevision!==e.sourceRevision||
  w.repository!=='tibame201020/Queqiao'||g.repository!==w.repository||
  w.controllerRunId!==e.controllerRunId||g.controllerRunId!==e.controllerRunId||
  w.controllerAttempt!==e.controllerAttempt||g.controllerAttempt!==e.controllerAttempt||
  w.workerRunId!==e.workerRunId||g.workerRunId!==e.workerRunId||
  w.date!==e.date||g.date!==e.date||w.leaseId!==g.leaseId||w.environmentId!==g.environmentId||
  g.workerAuditSha256!==h(workerArchiveRaw)||
  typeof w.receipt.eventId!=='string'||typeof g.receipt.eventId!=='string'||w.receipt.eventId===g.receipt.eventId)
  return fail();
 const plan=prepareGate3DraftPlan(source,{...e,sourceRepository:'tibame201020/Queqiao',targetRepository:'tibame201020/signal-notes',baseBranch:'main'});
 let recomputed:ReturnType<typeof completeGate3WorkerEvidence>;
 try{recomputed=completeGate3WorkerEvidence(w.workerProof,{controllerRunId:e.controllerRunId,controllerAttempt:e.controllerAttempt,
  workerRunId:e.workerRunId,environmentId:String(w.environmentId),leaseId:String(w.leaseId),date:e.date,
  leaseState:'disposed',workerConclusion:'cancelled'});}catch{return fail();}
 if(!same(recomputed,completed)||recomputed.articleSha256!==plan.articleSha256||
  w.workerProof.articleSha256!==plan.articleSha256||w.workerProof.path!==plan.path)return fail();
 return {schema:'queqiao.gate3.delegated-handoff.v1' as const,sourceRevision:e.sourceRevision,
  controllerRunId:e.controllerRunId,controllerAttempt:e.controllerAttempt,
  workerRunId:e.workerRunId,workerAttempt:e.workerAttempt,date:e.date,
  environmentId:recomputed.environmentId,leaseId:recomputed.leaseId,
  taskId:plan.taskId,logicalKey:plan.logicalKey,path:plan.path,articleSha256:plan.articleSha256,
  sourceArtifact:source,sourceArtifactSha256:h(JSON.stringify(source)+'\n'),
  workerAuditSha256:h(workerArchiveRaw),githubAuditSha256:h(githubArchiveRaw),
  workerReadEventId:w.receipt.eventId as string,githubReadEventId:g.receipt.eventId as string,
  leaseState:'disposed' as const,workerConclusion:'cancelled' as const,
  publication:'not_observed' as const,fullGatePassed:false as const};
}
export function verifyGate3DelegatedHandoff(raw:unknown,completed:unknown,workerArchiveRaw:string,githubArchiveRaw:string,e:HandoffExpected){
 if(!obj(raw)||raw.schema!=='queqiao.gate3.delegated-handoff.v1')return fail();
 const canonical=prepareGate3DelegatedHandoff(raw.sourceArtifact,completed,workerArchiveRaw,githubArchiveRaw,e);
 if(!same(raw,canonical))return fail();
 return canonical;
}
