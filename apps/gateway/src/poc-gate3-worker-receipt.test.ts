import {describe,expect,it} from "vitest";
import {makeGate3Artifact,validateGate3Output} from "../../../packages/browser-harness-runtime/src/gate3-content.js";
import {createGate3Trace} from "../../../packages/browser-harness-runtime/src/gate3-trace.js";
import {verifyRoutedGate3Content} from "./poc-gate3-worker-receipt.js";
const workerRunId="38357516610", controllerRunId="38357477604", environmentId="gha_abcdef";
const fields=validateGate3Output(JSON.stringify({
 concept:"測試驅動開發先將預期行為寫成測試，讓需求具備可執行的驗收標準。",
 verification:"先看到測試失敗，再用最少的程式使測試通過，最後進行重構與回歸測試。",
 limitation:"這是一篇合成內容流程測試，不代表新聞、投資研究或正式發布的結果。"
}));
function artifact(){const a=makeGate3Artifact({runId:workerRunId,runAttempt:"1",date:"2026-10-13",
 fields,authenticated:true,userTurn:true,assistantTurn:true,generationFinished:true});
 return {...a,trace:createGate3Trace(a)};}
const expected={workerRunId,controllerRunId,controllerAttempt:"1",environmentId,date:"2026-10-13"};
function routed(a:unknown,environment=environmentId){
 return {_meta:{"dev.queqiao/routing":{environmentId:environment}},
 content:[{type:"text",text:"Workspace: runtime\nPath: gate3-artifact.json\nLines: 1-1 of 1\n\n"+JSON.stringify(a)}]};
}
describe("#124 same-Worker authenticated content evidence",()=>{
 it("accepts only a public draft independently validated and bound to the dispatched Worker",()=>{
  const a=artifact();expect(verifyRoutedGate3Content(routed(a),expected)).toEqual({
   schema:"queqiao.gate3.worker-content.v1",controllerRunId,controllerAttempt:"1",
   workerRunId,taskId:a.receipt.taskId,logicalKey:a.trace.logicalKey,
   articleSha256:a.receipt.articleSha256,date:"2026-10-13",path:a.path,contentVerified:true});
 });
 it("fails closed on wrong worker, forged content, duplicate keys and unobserved downstream claims",()=>{
  const a=artifact();
  for(const bad of [
   {...a,article:a.article+"x"},
   {...a,receipt:{...a.receipt,runId:controllerRunId}},
   {...a,receipt:{...a.receipt,articleSha256:"0".repeat(64)}},
   {...a,trace:{...a.trace,downstream:{...a.trace.downstream,connector:"completed"}}},
   {...a,extra:"private"},
  ])expect(()=>verifyRoutedGate3Content(routed(bad),expected)).toThrow();
  expect(()=>verifyRoutedGate3Content(routed(a,"gha_other"),expected)).toThrow();
  expect(()=>verifyRoutedGate3Content(routed(a),{...expected,workerRunId:"38357516611"})).toThrow();
  expect(()=>verifyRoutedGate3Content(routed(a),{...expected,date:"2026-10-14"})).toThrow();
  expect(()=>verifyRoutedGate3Content(routed(a),{...expected,controllerRunId:"oops"})).toThrow();
  expect(()=>verifyRoutedGate3Content({...routed(a),isError:true},expected)).toThrow();
  expect(()=>verifyRoutedGate3Content(routed(a),{...expected,controllerAttempt:"2"})).not.toThrow();
  // The controller attempt is separately authenticated by GITHUB_RUN_ATTEMPT, not invented from Worker artifact.
 });
});
