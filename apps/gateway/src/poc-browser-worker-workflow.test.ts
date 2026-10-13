import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root=process.cwd();
const controller=readFileSync(root+"/.github/workflows/runtime-provider-browser-controller.yml","utf8");
const worker=readFileSync(root+"/.github/workflows/runtime-provider-poc-worker.yml","utf8");
const controllerWorkflow=parse(controller) as Record<string,any>;
const workerWorkflow=parse(worker) as Record<string,any>;

describe("remote CI Browser Harness Phase 3 POC topology",()=>{
 it("restricts PR to same-repo legacy branch and main to manual dispatch, with no schedule",()=>{
  expect(controller).toContain("github.head_ref == 'feat/124-actions-worker-browser'");
  expect(controller).toContain("head.repo.full_name == github.repository");
  expect(controllerWorkflow.on.schedule).toBeUndefined();
  expect(controller).toContain("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
  expect(controller).not.toContain("pull_request_target:");
 });
 it("requires real Gateway+Worker registration before triggering browser through MCP",()=>{
  expect(controller).toContain("Provision ephemeral Worker through Runtime Provider");
  expect(controller).toContain("Wait for Worker registration and ready lease");
  expect(controller).toContain("poc-browser-worker-client.ts");
  expect(controller).toContain("QUEQIAO_POC_WORKER_RUN_ID");
 });
 it("allows only fixed synthetic CDP task on reviewed main or legacy POC Worker branch",()=>{
  const steps=workerWorkflow.jobs["runtime-worker"].steps as Array<{name?:string;run?:string;if?:string}>;
  expect(worker).toContain('GITHUB_REF_NAME === "main"');
  expect(worker).toContain('GITHUB_REF_NAME === "feat/124-actions-worker-browser"');
  expect(worker).toContain('packages/browser-harness-runtime/dist/public-browser-acceptance.js');
  expect(steps.some(s=>s.name==="Start CI-only Chrome for Browser Harness task" && s.if?.includes("feat/124-actions-worker-browser") && s.if?.includes("main"))).toBe(true);
  expect(worker).not.toContain("CHATGPT_BROWSER_SESSION_CAPSULE");
  expect(worker).toContain('ci-browser-metadata.json');
  expect(worker).toContain('GITHUB_RUN_ID');
 });
 it("protects all Node -e payloads from dash-prefixed dynamic runtime tokens",()=>{
  expect(worker).toContain('))" -- "$join_token"');
  expect(worker).toContain('))" -- "$transaction_id"');
  expect(worker).toContain('))" -- "$gateway"');
  expect(worker).toContain('))" -- "$LEASE_ID"');
 }); it("retains cleanup and bounded remote execution",()=>{
  expect(controller).toContain("Complete lease and verify provider cancellation");
  expect(worker).toContain("maxTimeoutMs: 60000");
  expect(worker).toContain("test ! -e");
 });
});
