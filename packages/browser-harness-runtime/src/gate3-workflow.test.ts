import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const workflow=readFileSync(".github/workflows/browser-harness-gate3.yml","utf8");
const gate1=readFileSync(".github/workflows/browser-harness-session-portability.yml","utf8");
describe("Gate 3 CI-only synthetic acceptance policy",()=>{
 it("leaves Gate 1 session gate without upload or altered controls",()=>{
  expect(gate1).not.toMatch(/upload-artifact|gate3_publish|CHATGPT_BROWSER_GATE3/);
 });
 it("keeps PR execution synthetic, with no secrets or live browser",()=>{
  expect(workflow).toMatch(/pull_request:/);
  expect(workflow).toMatch(/if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.gate3/);
  expect(workflow).toMatch(/needs: unit-tests/);
 });
 it("leaves publication to the already connected ChatGPT GitHub Connector outside Actions",()=>{
  expect(workflow).not.toContain("gate3_publish:");
  expect(workflow).not.toContain("SIGNAL_NOTES_GATE3_TOKEN");
  expect(workflow).not.toContain("GH_TOKEN:");
  expect(workflow).not.toContain("git push");
  expect(workflow).not.toContain("gh pr create");
  expect(workflow).not.toContain("publish-gate3-draft:");
  expect(workflow).not.toMatch(/\\bschedule:/);
  expect(workflow).toContain("gate3-out/gate3-artifact.json");
 });
 it("rechecks exact run/attempt and immutable content lineage before uploading any artifact",()=>{
  expect(workflow).toContain("Verify immutable Gate 3 provenance before artifact upload");
  expect(workflow).toContain("GATE3_EXPECTED_RUN_ID: ${{ github.run_id }}");
  expect(workflow).toContain("GATE3_EXPECTED_RUN_ATTEMPT: ${{ github.run_attempt }}");
  expect(workflow).toContain("gate3-trace-verify.ts");
  expect(workflow.indexOf("Verify immutable Gate 3 provenance before artifact upload"))
   .toBeLessThan(workflow.indexOf("Upload only validated public synthetic draft and receipt"));
  expect(workflow).not.toContain("CHATGPT_BROWSER_SESSION_CAPSULE_PART_1: ${{ env.");
 });
 it("uploads only a validated public synthetic result on success",()=>{
  expect(workflow).toMatch(/if: inputs\.gate3 && success\(\)/);
  expect(workflow).toContain("gate3-out/gate3-artifact.json");
  expect(workflow).not.toContain("upload-pages-artifact");
  expect(workflow).not.toContain("CHATGPT_BROWSER_SESSION_CAPSULE_PART_1: ${{ env.");
 });
});
