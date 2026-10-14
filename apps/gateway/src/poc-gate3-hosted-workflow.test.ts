import {readFileSync} from "node:fs";
import {parse} from "yaml";
import {describe,it,expect} from "vitest";
const workflow=readFileSync(".github/workflows/runtime-provider-browser-controller.yml","utf8");
const w=parse(workflow) as {on:{workflow_dispatch:{inputs:Record<string,unknown>}},jobs:Record<string,{if?:string;steps?:Array<{name?:string;if?:string,run?:string,env?:Record<string,string>}>}>};
describe("G3.3 Route B hosted main-only audit execution contract",()=>{
 it("requires explicit main-only opt-in and original immutable controller source",()=>{
  expect(w.on.workflow_dispatch.inputs).toHaveProperty("gate3_mcp_audit");
  expect(workflow).toContain("QUEQIAO_G3_MCP_AUDIT_PROBE");
  expect(workflow).toContain("G3_MCP_AUDIT");
  expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain("sourceRevision:process.env.GITHUB_SHA");
  expect(w.on).not.toHaveProperty("schedule");
 });
 it("routes exactly one auditable MCP call before disposal, then reopens original Gateway audit",()=>{
  const steps=w.jobs["phase3-e2e"].steps??[];
  const auditStep=steps.find(s=>s.name==="Verify independent original Gateway L3 audit evidence");
  const readStep=steps.find(s=>s.name==="Execute authenticated MCP read of same-Worker G3.2 content");
  const complete=steps.findIndex(s=>s.name==="Complete lease and verify provider cancellation");
  expect(readStep?.run).toContain("QUEQIAO_POC_G3_MCP_RECEIPT_PATH");
  expect(readStep?.run).toContain("G3_MCP_AUDIT");
  expect(auditStep?.run).toContain("poc-gate3-audit-finalize.ts");
  expect(steps.indexOf(auditStep!)).toBeGreaterThan(steps.indexOf(readStep!));
  expect(steps.indexOf(auditStep!)).toBeLessThan(complete);
  expect(workflow).not.toContain("SIGNAL_NOTES_GATE3_TOKEN");
  expect(workflow).not.toContain("git push");
 });
 it("executes GitHub HEAD only after worker content and retains two independently linked original events",()=>{
  const steps=w.jobs["phase3-e2e"].steps??[];
  const names=steps.map(s=>s.name);
  const worker=names.indexOf("Execute authenticated MCP read of same-Worker G3.2 content");
  const audit=names.indexOf("Verify independent original Gateway L3 audit evidence");
  const github=names.indexOf("Verify original Gateway GitHub HEAD audit before lease disposal");
  const dispose=names.indexOf("Complete lease and verify provider cancellation");
  expect(worker).toBeGreaterThan(-1);
  expect(audit).toBeGreaterThan(worker);
  expect(github).toBeGreaterThan(audit);
  expect(dispose).toBeGreaterThan(github);
  expect(steps[worker]?.run).toContain("QUEQIAO_POC_G3_GITHUB_RECEIPT_PATH");
  expect(steps[github]?.run).toContain("poc-gate3-github-finalize.ts");
  const verify=w.jobs["gate3-audit-recheck"].steps??[];
  expect(verify.some(s=>s.run?.includes("poc-gate3-github-artifact.ts"))).toBe(true);
  expect(workflow).toContain("gate3-github-evidence-");
  expect(workflow).not.toContain("GITHUB_PAT");
 });
 it("uploads only sanitized run-correlation proof and independently re-fetches in separate job",()=>{
  expect(workflow).toContain("gate3-audit-evidence-");
  expect(workflow).toContain("actions/download-artifact");
  expect(workflow).toContain("poc-gate3-audit-artifact.ts");
  expect(workflow).not.toContain("CHATGPT_BROWSER_SESSION_CAPSULE");
  expect(workflow).not.toContain("GITHUB_PAT");
 });
});