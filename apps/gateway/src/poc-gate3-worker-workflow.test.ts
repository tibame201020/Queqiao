import {readFileSync} from "node:fs";
import {parse} from "yaml";
import {describe,it,expect} from "vitest";
const controller=readFileSync(".github/workflows/runtime-provider-browser-controller.yml","utf8");
const worker=readFileSync(".github/workflows/runtime-provider-poc-worker.yml","utf8");
const c=parse(controller) as {on:Record<string,unknown>,jobs:Record<string,{steps:Array<{name?:string;if?:string,env?:Record<string,string>,run?:string}>}>};
const w=parse(worker) as {on:{workflow_dispatch:{inputs:Record<string,unknown>}},jobs:Record<string,{steps:Array<{name?:string;if?:string,env?:Record<string,string>,run?:string}>}>};
describe("#124 G3.2 same-controller -> ephemeral Worker -> authenticated synthetic content contract",()=>{
 it("accepts only explicit manual main G3.2 with fixed date and no PR secrets or schedule",()=>{
  expect(controller).toContain("gate3_worker:");
  expect(controller).toContain("gate3_date:");
  expect(controller).toContain("GATE3_WORKER");
  expect(controller).toContain("SOURCE_REVISION");
  expect(controller).toContain("sourceRevision");
  expect(c.on).not.toHaveProperty("schedule");
  expect(controller).not.toContain("SIGNAL_NOTES_GATE3_TOKEN");
  expect(controller).not.toContain("git push");
 });
 it("requires provider-correlated non-secret inputs to worker, with no session passing via runtime metadata",()=>{
  for(const name of ["task_kind","gate3_date","controller_run_id","controller_run_attempt"])expect(w.on.workflow_dispatch.inputs).toHaveProperty(name);
  expect(controller).toContain('"taskKind":"gate3-content"');
  expect(worker).not.toContain("secrets.CHATGPT_BROWSER_SESSION_CAPSULE }}\n          LEASE_ID:");
 });
 it("starts manual CI Chrome, authenticates and verifies inside the worker only for approved task_kind on main",()=>{
  const steps=w.jobs["runtime-worker"].steps;
  const boot=steps.find(x=>x.name==="Start G3.2 isolated authenticated Chrome");
  const generation=steps.find(x=>x.name==="Generate and validate G3.2 content on ephemeral Worker");
  expect(boot?.if).toContain("inputs.task_kind == 'gate3-content'");
  expect(boot?.if).toContain("github.ref_name == 'main'");
  expect(generation?.if).toContain("inputs.task_kind == 'gate3-content'");
  expect(generation?.env).toHaveProperty("CHATGPT_BROWSER_SESSION_CAPSULE_PART_1");
  expect(generation?.run).toContain("gate3-trace-verify.ts");
  expect(generation?.run).toContain("session-acceptance.ts");
  const workerStep=steps.find(x=>x.name==="Start Worker");
  expect(steps.indexOf(generation!)).toBeGreaterThan(steps.indexOf(workerStep!));
  expect(worker).not.toContain("SIGNAL_NOTES_GATE3_TOKEN");
 });
 it("only completes the lease after remote read_file validated a same-worker content receipt",()=>{
  expect(controller).toContain("poc-gate3-worker-client.ts");
  expect(controller.indexOf("poc-gate3-worker-client.ts")).toBeLessThan(controller.indexOf("Complete lease and verify provider cancellation"));
  expect(controller).toContain("QUEQIAO_POC_CONTROLLER_RUN_ID");
  expect(controller).toContain("QUEQIAO_POC_WORKER_RUN_ID");
 });
});
