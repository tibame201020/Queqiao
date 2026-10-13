import {describe,it,expect} from "vitest";
import {classifyAbEvidence,type AbEvidencePair} from "./ab-contrast.js";
const sha="a".repeat(40);
const pair:AbEvidencePair={
 a:{runId:"101",headSha:sha,userTurnObserved:true,assistantCompleted:true},
 b:{runId:"102",headSha:sha,appSelected:true,userTurnObserved:false,toolReceiptVerified:false},
};
describe("G3.3 A/B evidence cannot be stitched or promoted to a Connector PASS",()=>{
 it("classifies the real-shaped no-App PASS / App user-turn gap",()=>{
  expect(classifyAbEvidence(pair)).toBe("app_enabled_user_turn_unconfirmed");
 });
 it("rejects a different commit or reusing one run for both arms",()=>{
  expect(classifyAbEvidence({...pair,b:{...pair.b,headSha:"b".repeat(40)}})).toBe("invalid_pair");
  expect(classifyAbEvidence({...pair,b:{...pair.b,runId:"101"}})).toBe("invalid_pair");
 });
 it("requires A1 to have real user and finished Assistant turns",()=>{
  expect(classifyAbEvidence({...pair,a:{...pair.a,userTurnObserved:false}})).toBe("no_app_control_failed");
 });
 it("never calls B1 verified merely because the App was selected or the user turn appeared",()=>{
  expect(classifyAbEvidence({...pair,b:{...pair.b,userTurnObserved:true}})).toBe("connector_unverified");
  expect(classifyAbEvidence({...pair,b:{...pair.b,appSelected:false}})).toBe("app_selection_unverified");
 });
 it("requires separately authenticated provider receipt even if both arms look complete",()=>{
  expect(classifyAbEvidence({...pair,b:{...pair.b,userTurnObserved:true,toolReceiptVerified:true}}))
   .toBe("candidate_for_provider_review");
 });
});
