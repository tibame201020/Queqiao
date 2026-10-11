import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const verdict=readFileSync("packages/browser-harness-runtime/src/session-verdict.ts","utf8");
const acceptance=readFileSync("packages/browser-harness-runtime/src/session-acceptance.ts","utf8");
const evidence=readFileSync("packages/browser-harness-runtime/src/session-auth-evidence.ts","utf8");
describe("authenticated session acceptance is not guest-mode acceptance",()=>{
 it("requires both real session evidence and usable composer",()=>{
  expect(verdict).toContain('signals.sessionConfirmed===true?"authenticated":"guest_composer"');
  expect(acceptance).toContain('readSessionEvidence(page)');
  expect(acceptance).toContain('verdict === "authenticated"');
 });
 it("uses a read-only same-origin session check that only emits booleans",()=>{
  expect(evidence).toContain('credentials:"same-origin"');
  expect(evidence).toContain('sessionConfirmed:confirmed');
  expect(evidence).not.toMatch(/console\.log\(|accessToken\s*:/);
 });
 it("never considers a challenge page to be accepted",()=>{
  expect(acceptance).toContain('if(!sessionEvidenceChecked && classifySessionPage(last)==="guest_composer")');
  expect(verdict.indexOf('return "browser_challenge"')).toBeLessThan(verdict.indexOf('return signals.sessionConfirmed===true'));
 });
});
