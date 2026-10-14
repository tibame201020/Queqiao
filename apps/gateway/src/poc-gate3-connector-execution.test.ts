import {createHash} from "node:crypto";
import {describe,it,expect} from "vitest";
import {validateCustomMcpExecutionReceipt} from "./poc-gate3-connector-execution.js";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const expected={controllerRunId:"38515396065",controllerAttempt:"1",workerRunId:"38365362251",workerAttempt:"1",environmentId:"gha_worker_alpha",leaseId:"ee9f4f43-777b-4578-8fce-e7a4de693898",taskId:"gate3-38365362251-1",logicalKey:"gate3/synthetic-2026-10-14",repository:"tibame201020/Queqiao",action:"read_default_head",requestSha256:hash("public-request"),resultSha256:hash("public-result")};
const receipt={schema:"queqiao.gate3.connector-execution.v1",provider:"queqiao_custom_mcp",...expected,principalDigest:hash("non-identifying-principal"),eventId:"9c3e12b1-72b7-433f-801d-8c61b24a86a4",outcome:"success",executionObserved:true};
const witness={source:"authenticated_gateway_audit",authenticated:true,eventId:receipt.eventId,provider:receipt.provider,action:receipt.action,requestSha256:receipt.requestSha256,resultSha256:receipt.resultSha256,taskId:receipt.taskId};
describe("G3.3 custom MCP server-originated receipt validator",()=>{
 it("accepts only correlated original server event plus independent witness as candidate",()=>{
  expect(validateCustomMcpExecutionReceipt(receipt,expected,witness)).toBe("candidate_for_independent_review");
 });
 it("rejects a matching model/Browser receipt lacking an authenticated original witness",()=>{
  expect(validateCustomMcpExecutionReceipt(receipt,expected,null)).toBe("witness_missing");
  expect(validateCustomMcpExecutionReceipt(receipt,expected,{...witness,authenticated:false})).toBe("witness_untrusted");
 });
 it("rejects cross-run, wrong lease/action/result and independent github instead of Queqiao provider",()=>{
  for(const field of ["controllerRunId","workerRunId","environmentId","leaseId","taskId","repository","action","requestSha256","resultSha256"] as const)
   expect(validateCustomMcpExecutionReceipt({...receipt,[field]:"different"},expected,witness)).toBe("receipt_mismatch");
  expect(validateCustomMcpExecutionReceipt({...receipt,provider:"native_github_app"},expected,witness)).toBe("invalid_receipt");
  expect(validateCustomMcpExecutionReceipt(receipt,expected,{...witness,source:"browser_ui"})).toBe("witness_untrusted");
  expect(validateCustomMcpExecutionReceipt(receipt,expected,{...witness,eventId:"different"})).toBe("witness_mismatch");
 });
 it("rejects extra/private fields, failed execution and self-asserted success",()=>{
  expect(validateCustomMcpExecutionReceipt({...receipt,accessToken:"secret"},expected,witness)).toBe("invalid_receipt");
  expect(validateCustomMcpExecutionReceipt({...receipt,outcome:"failed"},expected,witness)).toBe("invalid_receipt");
  expect(validateCustomMcpExecutionReceipt({...receipt,executionObserved:false},expected,witness)).toBe("invalid_receipt");
 });
});