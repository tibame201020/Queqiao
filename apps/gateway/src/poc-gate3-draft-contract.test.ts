import {describe,expect,it} from "vitest";
import {makeGate3Artifact,validateGate3Output} from "../../../packages/browser-harness-runtime/src/gate3-content.js";
import {createGate3Trace} from "../../../packages/browser-harness-runtime/src/gate3-trace.js";
import {prepareGate3DraftPlan,assessGate3RemoteClaim} from "./poc-gate3-draft-contract.js";

const date="2026-10-15",workerRunId="38585898277",controllerRunId="38585809542";
const fields=validateGate3Output(JSON.stringify({
 concept:"測試驅動開發要求先描述預期行為，再以失敗測試確認實作缺口與可驗證標準。",
 verification:"先讓測試失敗，再完成最小實作使測試通過，最後重構並再次確認回歸測試。",
 limitation:"這只是隔離的內容產線測試，不是新聞、投資研究或任何正式發表的文章。",
}));
const artifact=()=>{const a=makeGate3Artifact({runId:workerRunId,runAttempt:"1",date,fields,
 authenticated:true,userTurn:true,assistantTurn:true,generationFinished:true});return {...a,trace:createGate3Trace(a)};};
const ctx={controllerRunId,controllerAttempt:"1",workerRunId,workerAttempt:"1",date,
 sourceRepository:"tibame201020/Queqiao",targetRepository:"tibame201020/signal-notes",baseBranch:"main"};
const empty={branch:"absent" as const,pullRequests:[] as Array<{state:"open"|"closed";draft:boolean;head:string;base:string}>};
describe("#124 G3.4 restricted publication preflight (no side effects)",()=>{
 it("derives one deterministic test branch and draft-only candidate from exact original synthetic artifact",()=>{
  const a=artifact();const p=prepareGate3DraftPlan(a,ctx);
  expect(p).toEqual({schema:"queqiao.gate3.draft-plan.v1",sourceRepository:ctx.sourceRepository,
   targetRepository:ctx.targetRepository,baseBranch:"main",branch:`gate3/synthetic-${date}`,
   taskId:a.trace.taskId,logicalKey:a.trace.logicalKey,path:a.path,articleSha256:a.receipt.articleSha256,
   article:a.article,draft:true,mainWriteAllowed:false,productionScheduleAllowed:false,
   publicationState:"preflight_only"});
  expect(assessGate3RemoteClaim(p,empty)).toBe("atomic_create_ref_required");
 });
 it("rejects forged hashes, traces, wrong Worker/attempt/date/repository and extra fields",()=>{
  const a=artifact();const bads=[{...a,article:a.article+"x"},{...a,trace:{...a.trace,downstream:{...a.trace.downstream,connector:"completed"}}},
   {...a,receipt:{...a.receipt,articleSha256:"0".repeat(64)}},{...a,extra:"private"}];
  for(const b of bads)expect(()=>prepareGate3DraftPlan(b,ctx)).toThrow("G34_ARTIFACT_INVALID");
  for(const c of [{...ctx,workerRunId:"1"},{...ctx,workerAttempt:"2"},{...ctx,date:"2026-10-14"},
   {...ctx,targetRepository:"tibame201020/Queqiao"},{...ctx,baseBranch:"release"},
   {...ctx,sourceRepository:"attacker/Queqiao"},{...ctx,controllerRunId:"0"}])
   expect(()=>prepareGate3DraftPlan(a,c)).toThrow();
 });
 it("blocks duplicate branch, any prior PR including closed, unknown remote state and contradictory inventory",()=>{
  const p=prepareGate3DraftPlan(artifact(),ctx);const prior={state:"closed" as const,draft:true,head:p.branch,base:"main"};
  expect(assessGate3RemoteClaim(p,{branch:"present",pullRequests:[]})).toBe("halt_existing_branch");
  expect(assessGate3RemoteClaim(p,{branch:"absent",pullRequests:[prior]})).toBe("halt_prior_pr");
  expect(assessGate3RemoteClaim(p,{branch:"unknown",pullRequests:[]})).toBe("halt_unconfirmed_remote");
  expect(assessGate3RemoteClaim(p,{branch:"absent",pullRequests:[],complete:false})).toBe("halt_unconfirmed_remote");
  expect(assessGate3RemoteClaim(p,{branch:"absent",pullRequests:[{...prior,head:"another"}]})).toBe("halt_unconfirmed_remote");
 });
 it("requires an atomic create-ref and subsequent independent branch/commit/PR/CI validation, never treats a preflight as a write",()=>{
  const p=prepareGate3DraftPlan(artifact(),ctx);
  expect(p.publicationState).toBe("preflight_only");
  expect(Object.keys(p)).not.toContain("commitSha");
  expect(assessGate3RemoteClaim(p,empty)).not.toBe("published");
 });
});
