import {describe,it,expect} from "vitest";
import {assessL3EvidenceBoundary,type L3EvidenceSignals} from "./connector-l3-evidence.js";
const base:L3EvidenceSignals={
 source:"none",trustedProducerAvailable:false,sourceRecordAuthenticated:false,
 sameConversation:false,runMarkerMatched:false,actionMatched:false,resultMatched:false,
};
describe("G3.3 L3 provenance boundary",()=>{
 it("rejects missing provider log even when independently matched UI L1/L2 are already PASS",()=>{
  expect(assessL3EvidenceBoundary(base)).toBe("source_unavailable");
  expect(assessL3EvidenceBoundary({...base,source:"normal_ui",resultMatched:true})).toBe("not_provider_evidence");
  expect(assessL3EvidenceBoundary({...base,source:"independent_github_read",resultMatched:true})).toBe("not_provider_evidence");
  expect(assessL3EvidenceBoundary({...base,source:"another_chat_tool",resultMatched:true})).toBe("not_provider_evidence");
 });
 it("does not accept an unauthenticated assertion of an audit log",()=>{
  expect(assessL3EvidenceBoundary({...base,source:"approved_app_activity_log",sourceRecordAuthenticated:true,
   sameConversation:true,runMarkerMatched:true,actionMatched:true,resultMatched:true}))
   .toBe("source_unavailable");
  expect(assessL3EvidenceBoundary({...base,source:"approved_app_activity_log",trustedProducerAvailable:true,
   sourceRecordAuthenticated:false,sameConversation:true,runMarkerMatched:true,actionMatched:true,resultMatched:true}))
   .toBe("record_unverified");
 });
 it("requires all independent correlations before marking only a candidate, never auto-pass",()=>{
  const good:L3EvidenceSignals={source:"approved_app_activity_log",trustedProducerAvailable:true,
   sourceRecordAuthenticated:true,sameConversation:true,runMarkerMatched:true,actionMatched:true,resultMatched:true};
  expect(assessL3EvidenceBoundary(good)).toBe("candidate_for_independent_review");
  for(const key of ["sameConversation","runMarkerMatched","actionMatched","resultMatched"] as const){
   expect(assessL3EvidenceBoundary({...good,[key]:false})).toBe("correlation_incomplete");
  }
 });
});
