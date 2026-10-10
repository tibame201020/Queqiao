import { describe, expect, it, vi } from "vitest";
import { GitHubActionsRecoveryAttestor } from "./recovery-attestation.js";
import type { GitHubActionsOidcClaims } from "./index.js";

const leaseId="11111111-1111-4111-8111-111111111111";
const input={leaseId,runId:7788,token:"a".repeat(48),
 repository:"example/runtime-host",workflowId:"runtime.yml",ref:"main"};
const valid:GitHubActionsOidcClaims={
 repository:"example/runtime-host",runId:7788,
 workflowRef:"example/runtime-host/.github/workflows/runtime.yml@refs/heads/main",
 ref:"refs/heads/main",eventName:"workflow_dispatch",
 subject:"repo:example/runtime-host:ref:refs/heads/main",
};
describe("GitHub signed OIDC recovery evidence",()=>{
 it("requires task-scoped audience and exact signed run claims",async()=>{
  const verify=vi.fn(async()=>valid);
  const attestor=new GitHubActionsRecoveryAttestor({verify});
  await expect(attestor.attest(input)).resolves.toEqual({runId:7788,leaseId});
  expect(verify).toHaveBeenCalledWith(input.token,"urn:queqiao:run-recovery:"+leaseId);
 });
 it.each([
  ["run id",{runId:7789}],["repository",{repository:"evil/repo"}],
  ["workflow",{workflowRef:"example/runtime-host/.github/workflows/other.yml@refs/heads/main"}],
  ["ref",{ref:"refs/heads/other"}],["event",{eventName:"push"}],
  ["subject",{subject:"repo:other/other:ref:refs/heads/main"}],
 ])("rejects genuine OIDC token with wrong %s",async(_,overrides)=>{
  const attestor=new GitHubActionsRecoveryAttestor({
    verify:vi.fn(async()=>({...valid,...overrides})),
  });
  await expect(attestor.attest(input)).rejects.toThrow(/provenance mismatch/i);
 });
 it("denies OIDC signature failure and rejects malformed caller input before verification",async()=>{
  const verify=vi.fn(async()=>{throw Error("JWT signature failed");});
  const attestor=new GitHubActionsRecoveryAttestor({verify});
  await expect(attestor.attest(input)).rejects.toThrow(/signature failed/);
  await expect(attestor.attest({...input,leaseId:"untrusted"})).rejects.toThrow();
  expect(verify).toHaveBeenCalledTimes(1);
 });
});
