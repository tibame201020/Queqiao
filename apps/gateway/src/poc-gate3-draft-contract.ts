import {assessGate3Trace,type Gate3Trace} from "@queqiao/browser-harness-runtime/gate3-trace";
import type {Gate3Receipt} from "@queqiao/browser-harness-runtime/gate3-content";

const ID=/^[1-9]\d{0,19}$/, ATT=/^[1-9]\d{0,7}$/;
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const keys=(v:Record<string,unknown>)=>Object.keys(v).sort().join(",");

type WorkerArtifact={article:string;path:string;receipt:Gate3Receipt;trace:Gate3Trace};
export type DraftContext={controllerRunId:string;controllerAttempt:string;workerRunId:string;workerAttempt:string;
 date:string;sourceRepository:string;targetRepository:string;baseBranch:string};
export type Gate3DraftPlan={schema:"queqiao.gate3.draft-plan.v1";sourceRepository:"tibame201020/Queqiao";
 targetRepository:"tibame201020/signal-notes";baseBranch:"main";branch:string;taskId:string;logicalKey:string;
 path:string;articleSha256:string;article:string;draft:true;mainWriteAllowed:false;
 productionScheduleAllowed:false;publicationState:"preflight_only"};
/** Pure candidate only. In particular, this is not evidence of an authorized GitHub write.
 * The caller must independently authenticate live Worker/Lease, original Gateway audits,
 * GitHub write authorization, and original remote inventory before any side effect.
 */
export function prepareGate3DraftPlan(raw:unknown,c:DraftContext):Gate3DraftPlan{
 if(!ID.test(c.controllerRunId)||!ATT.test(c.controllerAttempt)||!ID.test(c.workerRunId)||
  c.workerAttempt!=="1"||!validDate(c.date)||c.sourceRepository!=="tibame201020/Queqiao"||
  c.targetRepository!=="tibame201020/signal-notes"||c.baseBranch!=="main")
  throw Error("G34_CONTEXT_INVALID");
 if(!obj(raw)||keys(raw)!=="article,path,receipt,trace"||typeof raw.article!=="string"||
  raw.article.length>12000||typeof raw.path!=="string"||!obj(raw.receipt)||!obj(raw.trace))
  throw Error("G34_ARTIFACT_INVALID");
 const a=raw as WorkerArtifact;
 if(assessGate3Trace(a,a.trace,{runId:c.workerRunId,runAttempt:c.workerAttempt})!=="valid"||
  a.receipt.date!==c.date||a.trace.date!==c.date||
  a.trace.taskId!==`gate3-${c.workerRunId}-${c.workerAttempt}`||
  a.trace.logicalKey!==`gate3/synthetic-${c.date}`||
  a.path!==`src/content/posts/gate3-synthetic-${c.date}/index.md`)
  throw Error("G34_ARTIFACT_INVALID");
 return {schema:"queqiao.gate3.draft-plan.v1",sourceRepository:"tibame201020/Queqiao",
  targetRepository:"tibame201020/signal-notes",baseBranch:"main",branch:`gate3/synthetic-${c.date}`,
  taskId:a.trace.taskId,logicalKey:a.trace.logicalKey,path:a.path,articleSha256:a.receipt.articleSha256,
  article:a.article,draft:true,mainWriteAllowed:false,productionScheduleAllowed:false,
  publicationState:"preflight_only"};
}

type RemoteInventory={branch:"absent"|"present"|"unknown";complete?:boolean;
 pullRequests:Array<{state:"open"|"closed";draft:boolean;head:string;base:string}>};
export type ClaimPreflight="atomic_create_ref_required"|"halt_existing_branch"|"halt_prior_pr"|"halt_unconfirmed_remote";
/** A branch-name collision MUST be resolved by an atomic GitHub create-ref, never check-then-put.
 * Any 422, uncertain HTTP response or past branch/PR must stop; no blind retries, no upsert.
 * An empty snapshot is not a lock, and this function never asserts a publication success.
 */
export function assessGate3RemoteClaim(plan:Gate3DraftPlan,remote:RemoteInventory):ClaimPreflight{
 if(!remote||remote.complete===false||!Array.isArray(remote.pullRequests)||
  !["absent","present","unknown"].includes(remote.branch)||
  remote.pullRequests.some(p=>!p||!(["open","closed"].includes(p.state))||
   typeof p.draft!=="boolean"||p.head!==plan.branch||p.base!=="main"))
  return "halt_unconfirmed_remote";
 if(remote.branch==="unknown")return "halt_unconfirmed_remote";
 if(remote.branch==="present")return "halt_existing_branch";
 if(remote.pullRequests.length)return "halt_prior_pr";
 return "atomic_create_ref_required";
}
