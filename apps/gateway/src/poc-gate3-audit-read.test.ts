import {createHash} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach,describe,it,expect} from "vitest";
import {AuditLogStore} from "@queqiao/audit";
import {makeGate3Artifact} from "@queqiao/browser-harness-runtime/gate3-content";
import {createGate3Trace} from "@queqiao/browser-harness-runtime/gate3-trace";
import {Gate3McpAuditRead,verifyPersistedGate3McpAudit} from "./poc-gate3-audit-read.js";
import type {WorkerRegistry} from "./worker-registry.js";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const binding={controllerRunId:"38515396065",controllerAttempt:"1",workerRunId:"38365362251",workerAttempt:"1",environmentId:"gha_worker_alpha",leaseId:"ee9f4f43-777b-4578-8fce-e7a4de693898",date:"2026-10-14",repository:"tibame201020/Queqiao"};
const sentence="測試驅動開發會先建立可驗證的失敗條件，然後使用明確的工程證據判定成功。";
const artifact=makeGate3Artifact({runId:binding.workerRunId,runAttempt:"1",date:binding.date,
 fields:{concept:sentence,verification:sentence,limitation:sentence},
 authenticated:true,userTurn:true,assistantTurn:true,generationFinished:true});
const payload=JSON.stringify({...artifact,trace:createGate3Trace(artifact)});
let dir="";
afterEach(async()=>{if(dir)await rm(dir,{recursive:true,force:true});dir="";});
function fixture(opts:{wrongRoute?:boolean;writeFails?:boolean;leaseState?:string;failRead?:boolean}={}){
 let calls=0;
 const workers={
  async requireTool(workspace:string,tool:string,environmentId:string){
   expect([workspace,tool,environmentId]).toEqual(["runtime","read_file",binding.environmentId]);
  },
  async readFile(input:{workspaceId:string;environmentId?:string;path:string;offset:number;limit:number}){
   calls++;
   expect(input).toEqual({workspaceId:"runtime",environmentId:binding.environmentId,path:"gate3-artifact.json",offset:0,limit:1});
   if(opts.failRead)throw Error("worker_unavailable");
   return {value:{path:"gate3-artifact.json",text:payload,startLine:1,endLine:1,totalLines:1},
    routing:{environmentId:opts.wrongRoute?"gha_other":binding.environmentId,requestedTransport:null,selectedTransport:"http",selectionReason:"configured_order"}};
  },
 } as unknown as WorkerRegistry;
 const lease={state:opts.leaseState??"ready",expiresAt:"2099-01-01T00:00:00Z",
  worker:{workerId:"g3-worker",environmentId:binding.environmentId},
  metadata:{taskKind:"gate3-content",gate3Date:binding.date,controllerRunId:binding.controllerRunId,controllerRunAttempt:binding.controllerAttempt},
  providerMetadata:{runId:binding.workerRunId,environmentId:binding.environmentId}};
 const coordinator={get:(leaseId:string)=>leaseId===binding.leaseId?lease:undefined};
 return {workers,coordinator,calls:()=>calls};
}
describe("G3.3 Route B server-originated real Worker read + durable Gateway audit",()=>{
 it("writes an original event only after a routed, validated read; independent new store retrieves witness",async()=>{
  dir=await mkdtemp(path.join(tmpdir(),"g3-mcp-audit-"));
  const store=new AuditLogStore(dir);const {workers,coordinator,calls}=fixture();
  const service=new Gate3McpAuditRead(binding,workers,coordinator,store);
  const receipt=await service.execute("oauth-client-private");
  expect(receipt).toMatchObject({schema:"queqiao.gate3.connector-execution.v1",provider:"queqiao_custom_mcp",
   ...binding,taskId:"gate3-38365362251-1",logicalKey:"gate3/synthetic-2026-10-14",
   action:"read_gate3_artifact",outcome:"success",executionObserved:true});
  expect(receipt.principalDigest).toBe(sha("oauth-client-private"));
  expect(receipt).not.toHaveProperty("article");
  expect(calls()).toBe(1);
  const independent=new AuditLogStore(dir);
  expect(await verifyPersistedGate3McpAudit(independent,receipt,binding)).toBe("candidate_for_independent_review");
  const events=await independent.query({category:"tool",action:"gate3.read_artifact"});
  expect(events.events).toHaveLength(1);
  expect(JSON.stringify(events.events)).not.toContain("oauth-client-private");
  expect(JSON.stringify(events.events)).not.toContain(sentence);
  expect(await verifyPersistedGate3McpAudit(independent,{...receipt,resultSha256:"f".repeat(64)},binding)).toBe("witness_mismatch");
 });
 it("fails closed on wrong lease, bad route, failed read or audit append; no self-attested receipt",async()=>{
  for(const options of [{leaseState:"disposed"},{wrongRoute:true},{failRead:true}]){
   dir=await mkdtemp(path.join(tmpdir(),"g3-mcp-audit-"));
   const store=new AuditLogStore(dir),{workers,coordinator}=fixture(options);
   const service=new Gate3McpAuditRead(binding,workers,coordinator,store);
   await expect(service.execute("oauth-client-private")).rejects.toThrow();
   expect((await store.query()).events).toHaveLength(0);
   await rm(dir,{recursive:true,force:true});dir="";
  }
  const {workers,coordinator}=fixture();
  const broken={append:async()=>{throw Error("disk-full");},query:async()=>({events:[],issues:[]})} as unknown as AuditLogStore;
  await expect(new Gate3McpAuditRead(binding,workers,coordinator,broken).execute("oauth-client-private")).rejects.toThrow("disk-full");
 });
 it("one-shot execution prevents duplicate read even when first outcome is uncertain",async()=>{
  dir=await mkdtemp(path.join(tmpdir(),"g3-mcp-audit-"));
  const {workers,coordinator,calls}=fixture();
  const service=new Gate3McpAuditRead(binding,workers,coordinator,new AuditLogStore(dir));
  await service.execute("oauth-client-private");
  await expect(service.execute("oauth-client-private")).rejects.toThrow("G3_MCP_ALREADY_CLAIMED");
  expect(calls()).toBe(1);
 });
});
