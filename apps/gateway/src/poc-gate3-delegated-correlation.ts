import type {VerifiedWorkerContent} from './poc-gate3-worker-receipt.js';

type TargetReadback={schema:'queqiao.gate3.target-readback.v1';result:'operator_assisted_target_consistent';headSha:string;prNumber:number;articleSha256:string;hostedWriteObserved:false;fullGatePassed:false};
type Expected={controllerRunId:string;controllerAttempt:string;workerRunId:string;date:string};
const sameKeys=(v:unknown,names:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===names.sort().join(',');
const fail=():never=>{throw Error('G34_DELEGATED_CORRELATION_INVALID');};
/** Pure data correlation only; caller must fetch Worker from original Queqiao proof and
 * GitHub readback from connected, authenticated provider. It never authenticates a
 * native ChatGPT App action, nor converts any matching hash into a gate verdict.
 */
export function assessGate3DelegatedCorrelation(worker:unknown,target:unknown,e:Expected){
 if(!sameKeys(worker,['schema','controllerRunId','controllerAttempt','workerRunId','taskId','logicalKey','articleSha256','date','path','contentVerified'])||
  !sameKeys(target,['schema','result','headSha','prNumber','articleSha256','hostedWriteObserved','fullGatePassed'])||
  !/^[1-9]\d{0,19}$/.test(e.controllerRunId)||!/^[1-9]\d{0,7}$/.test(e.controllerAttempt)||
  !/^[1-9]\d{0,19}$/.test(e.workerRunId)|| !/^\d{4}-\d{2}-\d{2}$/.test(e.date)||
  Number.isNaN(Date.parse(e.date))||new Date(e.date).toISOString().slice(0,10)!==e.date)return fail();
 const w=worker as VerifiedWorkerContent,t=target as TargetReadback;
 if(w.schema!=='queqiao.gate3.worker-content.v1'||w.contentVerified!==true||
  w.controllerRunId!==e.controllerRunId||w.controllerAttempt!==e.controllerAttempt||
  w.workerRunId!==e.workerRunId||w.taskId!==`gate3-${e.workerRunId}-1`||
  w.date!==e.date||w.logicalKey!==`gate3/synthetic-${e.date}`||
  w.path!==`src/content/posts/gate3-synthetic-${e.date}/index.md`||
  !/^[a-f0-9]{64}$/.test(w.articleSha256)||
  t.schema!=='queqiao.gate3.target-readback.v1'||t.result!=='operator_assisted_target_consistent'||
  !/^[a-f0-9]{40}$/.test(t.headSha)||!Number.isSafeInteger(t.prNumber)||t.prNumber<1||
  t.articleSha256!==w.articleSha256||t.hostedWriteObserved!==false||t.fullGatePassed!==false)return fail();
 return {schema:'queqiao.gate3.delegated-correlation.v1' as const,
  candidate:'hash_and_task_consistent' as const,taskId:w.taskId,logicalKey:w.logicalKey,
  articleSha256:w.articleSha256,targetHeadSha:t.headSha,prNumber:t.prNumber,
  nativeAppExecution:'not_established_by_hash_correlation' as const,
  gatewayWriteObserved:false as const,gatePassed:false as const};
}
