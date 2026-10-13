import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {parse} from "yaml";
import {assessConnectorReadProof} from "./connector-read-proof.js";

const workflowText=readFileSync(".github/workflows/browser-harness-session-portability.yml","utf8");
const workflow=parse(workflowText) as Record<string,any>;
const session=readFileSync("packages/browser-harness-runtime/src/session-acceptance.ts","utf8");

describe("G3.3 native ChatGPT GitHub App read-only capability preflight",()=>{
 it("requires reviewed-main explicit manual dispatch and secrets only in live job",()=>{
  expect(workflow.on.workflow_dispatch.inputs.connector_read_probe).toBeDefined();
  expect(workflow.jobs["session-portability"].if).toContain("github.ref == 'refs/heads/main'");
  expect(workflow.jobs["session-portability"].if).toContain("workflow_dispatch");
  expect(workflow.jobs["unit-tests"].steps.some((x:{run?:string})=>x.run?.includes("vitest"))).toBe(true);
 });
 it("disables Gate 2/3 in the same dispatch, supplies GitHub-reviewed SHA only as verifier",()=>{
  expect(workflowText).toContain("CHATGPT_BROWSER_CONNECTOR_READ_PROBE:");
  expect(workflowText).toContain("CONNECTOR_EXPECTED_SHA: ${{ github.sha }}");
  expect(session).toContain("runConnectorReadPreflight(page");
  expect(session).toContain("BROWSER_GATE_CONFLICT");
 });
 it("does not add a publisher, extra PAT, artifacts, or credential export",()=>{
  expect(workflowText).not.toMatch(/SIGNAL_NOTES_GATE3_TOKEN|GH_TOKEN:|git push|gh pr create|upload-artifact|pull_request_target/);
 });
 it("requires native tool observation AND an independently matched exact 40-hex SHA",()=>{
  const sha="fc93855949c723cce935c727014de00767c447f5";
  expect(assessConnectorReadProof({appSelected:true,toolObserved:true,reply:sha,expectedSha:sha})).toBe("verified");
  expect(assessConnectorReadProof({appSelected:true,toolObserved:false,reply:sha,expectedSha:sha})).toBe("tool_not_observed");
  expect(assessConnectorReadProof({appSelected:false,toolObserved:true,reply:sha,expectedSha:sha})).toBe("app_not_selected");
  expect(assessConnectorReadProof({appSelected:true,toolObserved:true,reply:"UNAVAILABLE",expectedSha:sha})).toBe("result_mismatch");
  expect(assessConnectorReadProof({appSelected:true,toolObserved:true,reply:"bad",expectedSha:sha})).toBe("result_mismatch");
 });
});
