import {describe,it,expect} from "vitest";
import {completeGate3WorkerEvidence} from "./poc-gate3-worker-completion.js";
const proof={schema:"queqiao.gate3.worker-content.v1",controllerRunId:"38357477604",controllerAttempt:"1",
 workerRunId:"38357516610",taskId:"gate3-38357516610-1",logicalKey:"gate3/synthetic-2026-10-13",
 articleSha256:"a".repeat(64),date:"2026-10-13",path:"src/content/posts/gate3-synthetic-2026-10-13/index.md",contentVerified:true};
const observed={controllerRunId:"38357477604",controllerAttempt:"1",workerRunId:"38357516610",
 environmentId:"gha_abcdef",leaseId:"6af72833-1126-44f8-84b9-85e2523e7a65",
 date:"2026-10-13",leaseState:"disposed",workerConclusion:"cancelled"};
describe("#124 G3.2 final only after content + actual provider disposal",()=>{
 it("binds the same Worker, Controller, date, hash and disposed lease into sanitized proof",()=>{
  expect(completeGate3WorkerEvidence(proof,observed)).toMatchObject({
   schema:"queqiao.gate3.controller-complete.v1",...observed,
   articleSha256:"a".repeat(64),taskId:"gate3-38357516610-1",
   contentVerified:true,connector:"not_observed",targetCi:"not_observed"});
 });
 it("fails closed on missing content and unverified cancellation, mismatched identity and fabricated stage",()=>{
  for(const item of [
   [null,observed],[{...proof,contentVerified:false},observed],
   [{...proof,workerRunId:"38357516611"},observed],
   [{...proof,articleSha256:"bad"},observed],
   [{...proof,extra:"private"},observed],
   [proof,{...observed,leaseState:"ready"}],[proof,{...observed,workerConclusion:"success"}],
   [proof,{...observed,controllerAttempt:"2"}],
   [proof,{...observed,leaseId:"not-a-uuid"}],
  ] as const)expect(()=>completeGate3WorkerEvidence(item[0],item[1])).toThrow();
 });
});
