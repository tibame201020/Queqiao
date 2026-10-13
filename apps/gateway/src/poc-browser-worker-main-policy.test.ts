import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {parse} from "yaml";

const controllerText=readFileSync(".github/workflows/runtime-provider-browser-controller.yml","utf8");
const workerText=readFileSync(".github/workflows/runtime-provider-poc-worker.yml","utf8");
const controller=parse(controllerText) as {jobs:Record<string,{if:string}>};
const worker=parse(workerText) as {jobs:Record<string,{steps:Array<{name?:string;if?:string,run?:string;env?:Record<string,unknown>}>}>};
describe("#124 reviewed-main remote Browser Harness E2E policy",()=>{
 it("opts in only on manually dispatched reviewed main; PR branch test remains isolated",()=>{
  const guard=controller.jobs["phase3-e2e"]?.if??"";
  expect(guard).toContain("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
  expect(guard).toContain("github.event_name == 'pull_request'");
  expect(guard).toContain("github.event.pull_request.head.repo.full_name == github.repository");
  expect(controllerText).not.toMatch(/\\bschedule:/);
 });
 it("permits only the existing exact synthetic Browser command on worker main or legacy POC branch",()=>{
  const steps=worker.jobs["runtime-worker"].steps;
  const bootstrap=steps.find(s=>s.name==="Bootstrap Worker")?.run??"";
  const browser=steps.find(s=>s.name==="Start CI-only Chrome for Browser Harness task");
  expect(bootstrap).toContain('process.env.GITHUB_REF_NAME === "main"');
  expect(bootstrap).toContain('process.env.GITHUB_REF_NAME === "feat/124-actions-worker-browser"');
  expect(bootstrap).toContain('packages/browser-harness-runtime/dist/public-browser-acceptance.js');
  expect(browser?.if).toContain("github.ref_name == 'main'");
  expect(browser?.if).toContain("github.ref_name == 'feat/124-actions-worker-browser'");
  expect(workerText).toContain("ci-browser-metadata.json");
  const generation=steps.find(s=>s.name==="Generate and validate G3.2 content on ephemeral Worker");
  expect(generation?.if).toContain("github.ref_name == 'main'");
  expect(generation?.if).toContain("inputs.task_kind == 'gate3-content'");
  const secretSteps=steps.filter(s=>Object.keys((s as {env?:Record<string,unknown>}).env??{}).some(k=>k.startsWith("CHATGPT_BROWSER_SESSION_CAPSULE")));
  expect(secretSteps.map(s=>s.name)).toEqual(["Generate and validate G3.2 content on ephemeral Worker"]);
  expect(steps.find(s=>s.name==="Bootstrap Worker")?.run).not.toContain("CHATGPT_BROWSER_SESSION_CAPSULE");
 });
 it("requires routed MCP Browser receipt and remote worker disposal, never ChatGPT session or cross-repo write",()=>{
  expect(controllerText).toContain("poc-browser-worker-client.ts");
  expect(controllerText).toContain('test "$final_state" = "disposed"');
  expect(controllerText).toContain('test "$conclusion" = "cancelled"');
  expect(controllerText).not.toContain("SIGNAL_NOTES_GATE3_TOKEN");
  expect(controllerText).not.toContain("CHATGPT_BROWSER_SESSION_CAPSULE");
  expect(controllerText).not.toContain("git push");
 });
});
