import {assessGate3Trace} from "../../../packages/browser-harness-runtime/src/gate3-trace.js";
import type {Gate3Receipt} from "../../../packages/browser-harness-runtime/src/gate3-content.js";

type Expected={environmentId:string;workerRunId:string;controllerRunId:string;controllerAttempt:string;date:string};
type Routed={isError?:boolean;_meta?:{"dev.queqiao/routing"?:{environmentId?:string}};
 content?:Array<{type?:string;text?:string}>};
export type VerifiedWorkerContent={
 schema:"queqiao.gate3.worker-content.v1";controllerRunId:string;controllerAttempt:string;
 workerRunId:string;taskId:string;logicalKey:string;articleSha256:string;date:string;
 path:string;contentVerified:true;
};
/** Read-only MCP result: reject untrusted route, tampering and all invented downstream success. */
export function verifyRoutedGate3Content(input:unknown,expected:Expected):VerifiedWorkerContent{
 const fail=():never=>{throw Error("G3_WORKER_RECEIPT_INVALID");};
 if(!/^[1-9]\d{0,19}$/.test(expected.workerRunId)||
    !/^[1-9]\d{0,19}$/.test(expected.controllerRunId)||
    !/^[1-9]\d{0,7}$/.test(expected.controllerAttempt)||
    !/^gha_[a-z0-9_]{4,64}$/.test(expected.environmentId))return fail();
 const r=input as Routed;
 if(!r || typeof r!=="object" || r.isError ||
  r._meta?.["dev.queqiao/routing"]?.environmentId!==expected.environmentId)return fail();
 const text=r.content?.find(x=>x.type==="text")?.text;
 if(typeof text!=="string"||text.length>12_000)return fail();
 const match=/^Workspace: runtime\r?\nPath: gate3-artifact\.json\r?\nLines: 1-1 of [1-9]\d*\r?\n\r?\n([^\r\n]+)(?:\r?\n)?$/.exec(text);
 if(!match)return fail();
 let raw:unknown;
 try{raw=JSON.parse(match[1]!);}catch{return fail();}
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();
 const record=raw as Record<string,unknown>;
 if(Object.keys(record).sort().join(",")!=="article,path,receipt,trace"||
    typeof record["article"]!=="string"||typeof record["path"]!=="string"||
    !record["receipt"]||typeof record["receipt"]!=="object"||Array.isArray(record["receipt"]))
   return fail();
 const a={article:record["article"],path:record["path"],receipt:record["receipt"] as Gate3Receipt};
 if(assessGate3Trace(a,record["trace"],{runId:expected.workerRunId,runAttempt:"1"})!=="valid")
  return fail();
 const t=record["trace"] as {taskId:string;logicalKey:string;articleSha256:string;date:string};
 if(t.date!==expected.date)return fail();
 return {schema:"queqiao.gate3.worker-content.v1",controllerRunId:expected.controllerRunId,
  controllerAttempt:expected.controllerAttempt,workerRunId:expected.workerRunId,
  taskId:t.taskId,logicalKey:t.logicalKey,articleSha256:t.articleSha256,
  date:t.date,path:a.path,contentVerified:true};
}
