import {describe,it,expect} from "vitest";
import {createHash} from "node:crypto";
import {validateGate3Output,makeGate3Artifact,assessGate3Handoff} from "./gate3-content.js";

const response=JSON.stringify({
 concept:"測試驅動開發先將預期行為寫成測試，讓需求具備可執行的驗收標準。",
 verification:"先看到測試失敗，再用最少的程式使測試通過，最後進行重構與回歸測試。",
 limitation:"這是一篇合成內容流程測試，不代表新聞、投資研究或正式發布的結果。"
});
const context={runId:"38350000000",runAttempt:"1",date:"2026-10-13"};

describe("Gate 3 generated-content and publication gate",()=>{
 it("accepts fresh independently generated structured Chinese content and renders only a draft test post",()=>{
  const fields=validateGate3Output(response);
  const artifact=makeGate3Artifact({...context,fields,authenticated:true,userTurn:true,assistantTurn:true,generationFinished:true});
  expect(artifact.receipt).toMatchObject({schema:"queqiao.gate3.receipt.v1",taskId:"gate3-38350000000-1",status:"completed",stage:"validated",completed:true,runId:context.runId});
  expect(artifact.article).toContain("draft: true");
  expect(artifact.article).toContain('slug: "gate3-synthetic-2026-10-13"');
  expect(artifact.article).toContain(fields.concept);
  expect(artifact.receipt.articleSha256).toBe(createHash("sha256").update(artifact.article).digest("hex"));
  expect(artifact.path).toBe("src/content/posts/gate3-synthetic-2026-10-13/index.md");
  expect(JSON.stringify(artifact.receipt)).not.toContain(fields.concept);
 });
 it.each([
  ["not-json","hello"],
  ["extra-field",JSON.stringify({...JSON.parse(response),identity:"private"})],
  ["missing-field",JSON.stringify({concept:"測試",verification:"測試"})],
  ["url",response.replace("測試驅動開發","https://example.com 測試驅動開發")],
  ["email",response.replace("測試驅動開發","a@b.com 測試驅動開發")],
  ["html",response.replace("測試驅動開發","<script> 測試驅動開發")],
  ["frontmatter",response.replace("測試驅動開發","--- 測試驅動開發")],
  ["short",JSON.stringify({...JSON.parse(response),concept:"太短"})],
  ["english-only",JSON.stringify({...JSON.parse(response),concept:"A simple test driven development process for software engineering."})],
  ["too-long",JSON.stringify({...JSON.parse(response),concept:"測試".repeat(300)})],
 ])("rejects %s before artifact or publication",(_label,value)=>expect(()=>validateGate3Output(value)).toThrow(/GATE3_INVALID_OUTPUT/));
 it("rejects partial stream, guest, missing user/assistant turns, malformed run ID and no completion",()=>{
  const fields=validateGate3Output(response);
  for (const delta of [{authenticated:false},{userTurn:false},{assistantTurn:false},{generationFinished:false},{runId:"oops"}]){
   expect(()=>makeGate3Artifact({...context,fields,authenticated:true,userTurn:true,assistantTurn:true,generationFinished:true,...delta})).toThrow(/GATE3_NOT_COMPLETE/);
  }
 });
 it("hands off only an immutable validated synthetic draft, never a credential or claimed publication",()=>{
  const artifact=makeGate3Artifact({...context,fields:validateGate3Output(response),authenticated:true,userTurn:true,assistantTurn:true,generationFinished:true});
  expect(assessGate3Handoff(artifact)).toBe("ready_for_connector");
  expect(assessGate3Handoff({...artifact,article:artifact.article+"X"})).toBe("hash_mismatch");
  expect(assessGate3Handoff({...artifact,receipt:{...artifact.receipt,status:"failed"}})).toBe("not_complete");
  expect(assessGate3Handoff({...artifact,path:"src/content/posts/daily-world-2026-10-13/index.md"})).toBe("wrong_target");
  expect(assessGate3Handoff({...artifact,article:artifact.article.replace("draft: true","draft: false")})).toBe("hash_mismatch");
 });
});
