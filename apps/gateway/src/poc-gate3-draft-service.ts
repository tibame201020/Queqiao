import {createHash} from 'node:crypto';
import {createAuditEvent,type AuditLogStore} from '@queqiao/audit';
import {verifyRoutedGate3Content} from './poc-gate3-worker-receipt.js';
import {resolveHostedGate3Binding,type HostedGate3Target} from './poc-gate3-hosted-binding.js';
import {verifyPersistedGate3McpAudit,type Gate3McpBinding} from './poc-gate3-audit-read.js';
import {verifyPersistedGate3GithubHeadAudit} from './poc-gate3-github-head.js';
import {prepareGate3DraftPlan} from './poc-gate3-draft-contract.js';
import {publishGate3RestrictedDraft} from './poc-gate3-draft-provider.js';
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
type Candidate=Parameters<typeof resolveHostedGate3Binding>[0][number];
type Registry={requireTool(tool:string,operation:string,environmentId:string):Promise<unknown>;readFile(args:{workspaceId:string;environmentId:string;path:string;offset:number;limit:number}):Promise<{value:{path:string;startLine:number;endLine:number;totalLines:number;text:string};routing:{environmentId:string}}>};
type Context={target:HostedGate3Target;binding:Gate3McpBinding;coordinator:{list():readonly Candidate[]};
 registry:Registry;audit:Pick<AuditLogStore,'append'|'query'>;workerReceipt:unknown;headReceipt:unknown;
 token:string;publish?:typeof publishGate3RestrictedDraft};
/** Prepared solely by trusted CI controller. Never accepts an MCP model input or exposes
 * itself as a tool until the separately approved target-specific App credential is present.
 * A one-shot submission is NOT a complete G3.4 verdict; target CI & independent write audit
 * must still succeed. Every failure after claiming is terminal for the run.
 */
export class Gate3HostedDraftSubmission{
 private claimed=false;
 constructor(private readonly ctx:Context){}
 async execute(principal:string){
  if(this.claimed)throw Error('G34_ALREADY_CLAIMED');this.claimed=true;
  const c=this.ctx,b=c.binding;
  if(!principal||!c.token||typeof c.token!=='string')throw Error('G34_NOT_AUTHORIZED');
  const w=c.workerReceipt as Record<string,unknown>|null,h=c.headReceipt as Record<string,unknown>|null;
  if(!w||!h||w.principalDigest!==hash(principal)||h.principalDigest!==hash(principal)||
   !w.eventId||w.eventId===h.eventId)throw Error('G34_PRINCIPAL_MISMATCH');
  const resolve=()=>{
   const observed=resolveHostedGate3Binding(c.coordinator.list(),c.target);
   if(JSON.stringify(observed)!==JSON.stringify(b))throw Error('G34_LEASE_CHANGED');
  };
  resolve();
  if(await verifyPersistedGate3McpAudit(c.audit,c.workerReceipt,b)!=='candidate_for_independent_review'||
   await verifyPersistedGate3GithubHeadAudit(c.audit,c.headReceipt,b,c.target.sourceRevision)!=='candidate_for_independent_review')
   throw Error('G34_ORIGINAL_GATEWAY_WITNESS_INVALID');
  resolve();
  await c.registry.requireTool('runtime','read_file',b.environmentId);
  const routed=await c.registry.readFile({workspaceId:'runtime',environmentId:b.environmentId,path:'gate3-artifact.json',offset:0,limit:1});
  const v=routed.value;
  const verified=verifyRoutedGate3Content({_meta:{'dev.queqiao/routing':routed.routing},content:[{type:'text',text:
   `Workspace: runtime\nPath: ${v.path}\nLines: ${v.startLine}-${v.endLine} of ${v.totalLines}\n\n${v.text}`}]},
   {environmentId:b.environmentId,workerRunId:b.workerRunId,controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,date:b.date});
  if(w.resultSha256!==hash(JSON.stringify(verified)))throw Error('G34_WORKER_READ_NOT_ORIGINAL');
  let raw:unknown;try{raw=JSON.parse(v.text);}catch{throw Error('G34_WORKER_ARTIFACT_INVALID');}
  const plan=prepareGate3DraftPlan(raw,{controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,
   workerRunId:b.workerRunId,workerAttempt:b.workerAttempt,date:b.date,sourceRepository:b.repository,
   targetRepository:'tibame201020/signal-notes',baseBranch:'main'});
  if(plan.articleSha256!==verified.articleSha256)throw Error('G34_ARTICLE_SHA_MISMATCH');
  resolve();
  const principalDigest=hash(principal),detail={controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,
   workerRunId:b.workerRunId,workerAttempt:b.workerAttempt,environmentId:b.environmentId,leaseId:b.leaseId,
   taskId:plan.taskId,logicalKey:plan.logicalKey,sourceRevision:c.target.sourceRevision,
   targetRepository:plan.targetRepository,branch:plan.branch,path:plan.path,articleSha256:plan.articleSha256,
   principalDigest,workerEventId:w.eventId,githubEventId:h.eventId};
  // Original audit intent is durably appended before any target mutation; failure stops.
  await c.audit.append(createAuditEvent({component:'gateway',category:'tool',action:'gate3.draft_intent',
   outcome:'success',subject:{provider:'queqiao_custom_mcp',taskId:plan.taskId},detail}));
  let submitted:Awaited<ReturnType<typeof publishGate3RestrictedDraft>>;
  try{submitted=await (c.publish??publishGate3RestrictedDraft)(plan,{token:c.token});}
  catch{
   try{await c.audit.append(createAuditEvent({component:'gateway',category:'tool',action:'gate3.draft_submission',
    outcome:'failed',subject:{provider:'queqiao_custom_mcp',taskId:plan.taskId},
    detail:{...detail,failureClass:'provider_submission_uncertain_no_retry'}}));}catch{throw Error('G34_FAILURE_AUDIT_UNCONFIRMED');}
   throw Error('G34_SUBMISSION_UNCONFIRMED_NO_RETRY');
  }
  if(submitted.state!=='submitted_pending_target_ci'||submitted.hostedGatePassed!==false||submitted.branch!==plan.branch||
   submitted.repository!==plan.targetRepository||submitted.articleSha256!==plan.articleSha256)
   throw Error('G34_SUBMISSION_RESULT_INVALID');
  await c.audit.append(createAuditEvent({component:'gateway',category:'tool',action:'gate3.draft_submission',
   outcome:'success',subject:{provider:'queqiao_custom_mcp',taskId:plan.taskId},
   detail:{...detail,baseSha:submitted.baseSha,headSha:submitted.headSha,blobSha:submitted.blobSha,
    prNumber:submitted.prNumber,stage:'submitted_pending_target_ci'}}));
  return submitted;
 }
}
