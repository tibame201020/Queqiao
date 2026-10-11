import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
const workflowText=readFileSync(".github/workflows/browser-harness-session-portability.yml","utf8");
const workflow=parse(workflowText) as Record<string,any>;
const source=readFileSync("packages/browser-harness-runtime/src/session-acceptance.ts","utf8");
const probe=readFileSync("packages/browser-harness-runtime/src/session-control.ts","utf8");
describe("same CI Runner, strict clean-context control policy",()=>{
 it("does not give PR code access to the existing Session Secret",()=>{
  expect(workflow.jobs["session-portability"].if).toContain("github.event_name == 'workflow_dispatch'");
  expect(workflow.jobs["session-portability"].if).toContain("github.ref == 'refs/heads/main'");
 });
 it("uses a fresh empty isolated Context before restoring any capsule",()=>{
  expect(probe).toContain('browser.newContext({storageState:{cookies:[],origins:[]}})');
  expect(source.indexOf("probeUnauthenticatedControl(browser)")).toBeLessThan(source.indexOf("context.addCookies(state.cookies)"));
  expect(source).toContain("assessSessionComparison(control,verdict)");
 });
 it("does not log page, storage content, Cookie names or credential material",()=>{
  expect(probe).not.toMatch(/console\.log\(|\.screenshot\(|storageState\(\{\s*path|\.addCookies\(|\.setItem\(/i);
  expect(workflowText).not.toMatch(/upload-artifact/);
 });
});
