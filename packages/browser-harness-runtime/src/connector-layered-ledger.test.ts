import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const ledger=readFileSync("docs/gate3-full-e2e.md","utf8");
describe("Issue #124 hosted layered receipt ledger",()=>{
 it("keeps the independently verified main-only hosted L1/L2 result and pending L3 distinct",()=>{
  expect(ledger).toContain("38515396065");
  expect(ledger).toContain("QG3-38515396065-1");
  expect(ledger).toContain("623f326b380ab5bbf34a4ad512261f4ad453909c");
  expect(ledger).toContain("`l1=confirmed`, `l2=confirmed`, `l3=not_proved`");
  expect(ledger).toContain("`providerReceiptVerified=false`");
  expect(ledger).toContain("`writeAttempted=false`");
  expect(ledger).not.toContain("G3.3 COMPLETE");
 });
});
