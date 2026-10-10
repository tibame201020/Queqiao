import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import path from "node:path";

const workflowPath=path.resolve(process.cwd(),".github/workflows/browser-harness-ci-runtime.yml");
const text=readFileSync(workflowPath,"utf8");
const workflow=parse(text) as Record<string,any>;

describe("CI-only Browser Harness workflow security and deliverables",()=>{
  it("supports manual GitHub Actions trigger with read-only repo permission",()=>{
    expect(workflow.on.workflow_dispatch).toBeDefined();
    expect(workflow.permissions).toEqual({contents:"read"});
  });
  it("starts fresh ephemeral Chrome and uses real Playwright CDP with receipt artifact",()=>{
    const steps=workflow.jobs["ci-browser-harness"].steps as Array<{name?:string;run?:string;uses?:string}>;
    expect(steps.some(s=>s.run?.includes("--headless=new")&&s.run?.includes("--user-data-dir"))).toBe(true);
    expect(steps.some(s=>s.run?.includes("public-browser-acceptance.ts"))).toBe(true);
    expect(steps.some(s=>s.uses?.startsWith("actions/upload-artifact@"))).toBe(true);
    expect(steps.some(s=>s.run?.includes("ci-browser-receipt.json")&&s.run?.includes("GITHUB_RUN_ID"))).toBe(true);
  });
  it("waits and retries profile cleanup after Chrome termination",()=>{
    const cleanup=workflow.jobs["ci-browser-harness"].steps.find((step:{name?:string})=>step.name==="Cleanup ephemeral Chrome");
    expect(cleanup.run).toContain("for attempt in");
    expect(cleanup.run).toContain("test ! -e");
  });  it("does not read ChatGPT credentials, persistent browser profiles or session secrets",()=>{
    expect(text).not.toMatch(/secrets\./i);
    expect(text).not.toMatch(/CHATGPT_BROWSER_SESSION_CAPSULE/i);
    expect(text).not.toMatch(/chatgpt\.com/i);
    expect(text).not.toMatch(/remote-allow-origins=\*/i);
  });
});
