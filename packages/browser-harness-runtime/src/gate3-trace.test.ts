import {describe,it,expect} from "vitest";
import {makeGate3Artifact,validateGate3Output} from "./gate3-content.js";
import {createGate3Trace,assessGate3Trace,assessGate3Target} from "./gate3-trace.js";
const fields=validateGate3Output(JSON.stringify({
 concept:"測試驅動開發先將預期行為寫成測試，讓需求具備可執行的驗收標準。",
 verification:"先看到測試失敗，再用最少的程式使測試通過，最後進行重構與回歸測試。",
 limitation:"這是一篇合成內容流程測試，不代表新聞、投資研究或正式發布的結果。"
}));
const artifact=(runId="38355846584",runAttempt="1",date="2026-10-13")=>
 makeGate3Artifact({runId,runAttempt,date,fields,authenticated:true,userTurn:true,
  assistantTurn:true,generationFinished:true});
describe("#124 Gate 3 one-task provenance and no-claim trace",()=>{
 it("binds public draft to logical date key and unique GitHub run attempt without inventing Worker/Connector success",()=>{
  const a=artifact(),t=createGate3Trace(a);
  expect(t).toEqual({schema:"queqiao.gate3.trace.v1",logicalKey:"gate3/synthetic-2026-10-13",
   taskId:"gate3-38355846584-1",runId:"38355846584",runAttempt:"1",date:"2026-10-13",
   stage:"content_validated",path:a.path,articleSha256:a.receipt.articleSha256,
   downstream:{worker:"not_observed",connector:"not_observed",targetCi:"not_observed",lease:"not_observed"}});
  expect(assessGate3Trace(a,t,{runId:"38355846584",runAttempt:"1"})).toBe("valid");
 });
 it("rejects forged downstream proof, wrong run/attempt, mismatched path, hash or extra fields",()=>{
  const a=artifact(),t=createGate3Trace(a);
  expect(assessGate3Trace(a,{...t,downstream:{...t.downstream,connector:"completed"}})).toBe("invalid_trace");
  expect(assessGate3Trace(a,{...t,taskId:"gate3-99-1"})).toBe("invalid_trace");
  expect(assessGate3Trace(a,{...t,path:"src/content/posts/daily-ai-2026-10-13/index.md"})).toBe("invalid_trace");
  expect(assessGate3Trace(a,{...t,articleSha256:"a".repeat(64)})).toBe("invalid_trace");
  expect(assessGate3Trace(a,{...t,token:"private"})).toBe("invalid_trace");
  expect(assessGate3Trace(a,t,{runId:"38355846585",runAttempt:"1"})).toBe("wrong_run");
  expect(assessGate3Trace(a,t,{runId:"38355846584",runAttempt:"2"})).toBe("wrong_run");
  expect(assessGate3Trace({...a,article:a.article+"x"},t)).toBe("invalid_artifact");
 });
 it("separates stable logical target from attempt, refuses reuse on rerun without asserting atomic GitHub locking",()=>{
  const first=createGate3Trace(artifact("38355846584","1"));
  const retried=createGate3Trace(artifact("38355846584","2"));
  const nextRun=createGate3Trace(artifact("38355846585","1"));
  const nextDay=createGate3Trace(artifact("38355846586","1","2026-10-14"));
  expect(first.logicalKey).toBe(retried.logicalKey);
  expect(first.logicalKey).toBe(nextRun.logicalKey);
  expect(first.taskId).not.toBe(retried.taskId);
  expect(assessGate3Target(first,null)).toBe("unclaimed");
  expect(assessGate3Target(retried,first)).toBe("duplicate_target");
  expect(assessGate3Target(nextRun,first)).toBe("duplicate_target");
  expect(assessGate3Target(first,first)).toBe("duplicate_target");
  expect(assessGate3Target(nextDay,first)).toBe("unclaimed");
 });
 it("does not create a passing trace from a failed or fabricated content receipt",()=>{
  const a=artifact();
  expect(()=>createGate3Trace({...a,receipt:{...a.receipt,completed:false}})).toThrow(/GATE3_TRACE_INVALID_ARTIFACT/);
  expect(()=>createGate3Trace({...a,receipt:{...a.receipt,articleSha256:"0".repeat(64)}})).toThrow(/GATE3_TRACE_INVALID_ARTIFACT/);
 });
});
