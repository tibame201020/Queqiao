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
 it("requires explicit scoped token and allows only a draft test branch and PR",()=>{
  expect(workflow).toContain("SIGNAL_NOTES_GATE3_TOKEN");
  expect(workflow).toContain("GATE3_MISSING_CROSS_REPO_CREDENTIAL");
  expect(workflow).toContain("GATE3_DUPLICATE_BRANCH");
  expect(workflow).toContain("GATE3_REMOTE_BRANCH_CHECK_FAILED");
  expect(workflow).toContain('git checkout -b "$GATE3_TARGET_BRANCH"');
  expect(workflow).toContain("gh pr create");
  expect(workflow).toContain("--draft");
  expect(workflow).not.toMatch(/\bschedule:/);
  expect(workflow).not.toContain("gh pr merge");
 });
 it("uploads only a validated public synthetic result on success",()=>{
  expect(workflow).toMatch(/if: inputs\.gate3 && success\(\)/);
  expect(workflow).toContain("gate3-out/gate3-artifact.json");
  expect(workflow).not.toContain("upload-pages-artifact");
  expect(workflow).not.toContain("CHATGPT_BROWSER_SESSION_CAPSULE_PART_1: ${{ env.");
 });
});
