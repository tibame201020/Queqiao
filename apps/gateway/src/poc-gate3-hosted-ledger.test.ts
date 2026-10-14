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
});
