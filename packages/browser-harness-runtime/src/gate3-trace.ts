import {assessGate3Handoff,type Gate3Receipt} from "./gate3-content.js";

type Artifact={receipt:Gate3Receipt;article:string;path:string};
type Downstream={"worker":"not_observed";"connector":"not_observed";"targetCi":"not_observed";"lease":"not_observed"};
export type Gate3Trace={
 schema:"queqiao.gate3.trace.v1";
 logicalKey:string;taskId:string;runId:string;runAttempt:string;date:string;
 stage:"content_validated";path:string;articleSha256:string;downstream:Downstream;
};
const ATTEMPT=/^gate3-(\d{1,20})-(\d{1,8})$/;
const downstream=():Downstream=>({worker:"not_observed",connector:"not_observed",
 targetCi:"not_observed",lease:"not_observed"});
/** A successful content receipt is NOT evidence of a remote Worker or GitHub side effect. */
export function createGate3Trace(artifact:Artifact):Gate3Trace{
 if(assessGate3Handoff(artifact)!=="ready_for_connector")throw Error("GATE3_TRACE_INVALID_ARTIFACT");
 const {receipt}=artifact;
 const match=ATTEMPT.exec(receipt.taskId);
 if(!match||match[1]!==receipt.runId||BigInt(match[1])===0n||BigInt(match[2]!)===0n)
  throw Error("GATE3_TRACE_INVALID_ARTIFACT");
 return {schema:"queqiao.gate3.trace.v1",
  logicalKey:`gate3/synthetic-${receipt.date}`,taskId:receipt.taskId,
  runId:receipt.runId,runAttempt:match[2]!,date:receipt.date,
  stage:"content_validated",path:artifact.path,articleSha256:receipt.articleSha256,
  downstream:downstream()};
}
function identical(expected:unknown,actual:unknown):boolean{
 if(expected===actual)return true;
 if(!expected||!actual||typeof expected!=="object"||typeof actual!=="object"||
    Array.isArray(expected)||Array.isArray(actual))return false;
 const a=expected as Record<string,unknown>,b=actual as Record<string,unknown>;
 const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
 return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&identical(a[k],b[k]));
}
/** Strict exact-shape comparison rejects unobserved downstream success and extra/private fields. */
export function assessGate3Trace(artifact:Artifact,trace:unknown,expected?:{runId:string;runAttempt:string}):
 "valid"|"invalid_artifact"|"wrong_run"|"invalid_trace"{
 let correct:Gate3Trace;
 try{correct=createGate3Trace(artifact)}catch{return "invalid_artifact";}
 if(expected&&(expected.runId!==correct.runId||expected.runAttempt!==correct.runAttempt))
  return "wrong_run";
 return identical(correct,trace)?"valid":"invalid_trace";
}
/** Pure duplicate detection, NOT an atomic cross-Run publication lock. */
export function assessGate3Target(next:Gate3Trace,existing:Gate3Trace|null):
 "unclaimed"|"duplicate_target"{
 return existing?.logicalKey===next.logicalKey?"duplicate_target":"unclaimed";
}
