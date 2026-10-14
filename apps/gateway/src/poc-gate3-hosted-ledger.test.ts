import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const doc=readFileSync("docs/gate3-full-e2e.md","utf8");
describe("Issue #124 real Route B hosted audit ledger",()=>{
 it("pins actual independent immutable evidence and correct acceptance boundary",()=>{
  for(const value of ["38569718518","38569775824",
   "979435313032c44e3c55bc829f7638b1d19e6488",
   "11897211276","gate3-audit-evidence-38569718518-1",
   "a7906f179cbcefed5e0f2ffc128e344e4b9cc16c821193c217ea49ae71ea1fa1",
   "candidate_for_independent_review","githubTargetRead=not_observed",
   "G3.3 NOT PASSED"]){
    expect(doc).toContain(value);
   }
  expect(doc).not.toContain("G3.3 COMPLETE");
 });
 it("pins the later independent public GitHub HEAD acceptance without promoting native GitHub App L3",()=>{
  for(const value of [
   "38585809542","38585898277","fc9d54b871b01cbd476a8338f39e5f57a060a8a7",
   "11905097866","11905132560","11904858109",
   "048dec1a-9bef-402c-8af9-396f5d5ba0ec","da6e695b-a8f2-4a51-a761-847c05dd4d8d",
   "af7d6d35f90a2ab91e0821146780059b6f4f32f936fcc9791932c275cb2fa45f",
   "7781f58ce6250dab07d564b623404be5ea46adfd1b1c8d015b48d0d841141be5",
   "archivedEventVerified=true","githubTargetRead=verified","writeAttempted=false",
   "G3.3 Route B hosted read-only Controller/Worker + public GitHub HEAD",
   "G3.4/G3.5 remain NOT STARTED","not** original/native ChatGPT GitHub App L3",
  ])expect(doc).toContain(value);
  expect(doc.indexOf("38569718518")).toBeLessThan(doc.lastIndexOf("38585809542"));
 });
});