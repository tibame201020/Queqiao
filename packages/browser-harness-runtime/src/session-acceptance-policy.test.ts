import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const source=readFileSync("packages/browser-harness-runtime/src/session-acceptance.ts","utf8");
const workflowText=readFileSync(".github/workflows/browser-harness-session-portability.yml","utf8");
const workflow=parse(workflowText) as Record<string,any>;
describe("secret-scoped session diagnostics workflow",()=>{
 it("keeps live login acceptance main-only and manually dispatched, never in PR",()=>{
  expect(workflow.jobs["session-portability"].if).toContain("github.event_name == 'workflow_dispatch'");
  expect(workflow.jobs["session-portability"].if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.jobs["unit-tests"].steps.some((s:{run?:string})=>
    s.run?.includes("npx vitest run packages/browser-harness-runtime/src"))).toBe(true);
 });
 it("restores credentials in memory and logs only aggregate diagnostics",()=>{
  expect(source).toContain("summarizeCookieRestore");
  expect(source).toContain("summarizeStorageRestore");
  expect(source).toContain("JSON.stringify(result)");
  expect(source).not.toMatch(/console\.log\((?:state|capsule|context|observedStorage)/);
 });
 it("never uploads any credential or browser-profile artifact",()=>{
  expect(workflowText).not.toContain("actions/upload-artifact@");
  expect(workflowText).not.toContain("storageState({ path:");
  expect(workflowText).not.toContain("pull_request_target:");
 });
});
