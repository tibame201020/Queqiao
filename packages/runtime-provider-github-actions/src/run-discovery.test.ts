import { describe, expect, it, vi } from "vitest";
import { GitHubActionsRunDiscovery, GitHubWorkflowRunFetchApi, runtimeRunTitle } from "./run-discovery.js";

const leaseId="11111111-1111-4111-8111-111111111111";
const input={
  owner:"example", repo:"runtime-host", workflowId:"runtime-provider-poc-worker.yml",
  ref:"feature/test", actor:"trusted-bot", leaseId,
  createdAt:"2026-10-10T01:00:00Z",
};
function run(overrides:Record<string,unknown>={}){
  return {
    id:7731, display_title:runtimeRunTitle(leaseId),event:"workflow_dispatch",
    head_branch:"feature/test",path:".github/workflows/runtime-provider-poc-worker.yml",
    actor:{login:"trusted-bot"},repository:{full_name:"example/runtime-host"},
    created_at:"2026-10-10T01:03:00Z",run_attempt:1,...overrides,
  };
}
function discovery(pages: Array<{total_count:number;workflow_runs:unknown[]}>){
  const api={listRuns:vi.fn(async (_q:unknown, page:number)=>pages[page-1] ?? {total_count:0,workflow_runs:[]})};
  return {reader:new GitHubActionsRunDiscovery(api),api};
}

describe("isolated read-only GitHub workflow run discovery",()=>{
  it("pins the exact workflow run-name to the immutable lease UUID",()=>{
    expect(runtimeRunTitle(leaseId)).toBe("Queqiao Runtime "+leaseId);
    expect(()=>runtimeRunTitle("anything else")).toThrow();
  });
  it("finds one candidate across pagination and does not automatically cancel it",async()=>{
    const nonmatching=Array.from({length:100},(_,i)=>run({id:10000+i,display_title:"other"}));
    const {reader,api}=discovery([
      {total_count:101,workflow_runs:nonmatching},
      {total_count:101,workflow_runs:[run()]},
    ]);
    await expect(reader.inspect(input)).resolves.toEqual({status:"candidate",runId:7731});
    expect(api.listRuns).toHaveBeenCalledTimes(2);
  });
  it("reports zero or ambiguous, never picking the most recent duplicate",async()=>{
    const {reader}=discovery([{total_count:2,workflow_runs:[run({id:7731}),run({id:7732})]}]);
    expect(await reader.inspect(input)).toEqual({status:"ambiguous"});
    const {reader:empty}=discovery([{total_count:1,workflow_runs:[run({actor:{login:"other"}})]}]);
    expect(await empty.inspect(input)).toEqual({status:"not_found"});
  });
  it("rejects spoofed title from other actor, ref, event, path, repository or time",async()=>{
    const wrong=[
      run({actor:{login:"intruder"}}),run({head_branch:"main"}),
      run({event:"push"}),run({path:".github/workflows/other.yml"}),
      run({repository:{full_name:"another/repo"}}),
      run({created_at:"2026-10-09T10:00:00Z"}),
      run({created_at:"2026-10-10T02:00:00Z"}),run({display_title:"Queqiao Runtime "+leaseId+" suffix"}),
    ];
    const {reader}=discovery([{total_count:wrong.length,workflow_runs:wrong}]);
    expect(await reader.inspect(input)).toEqual({status:"not_found"});
  });
  it("fails closed if the result set exceeds the maximum bounded scan",async()=>{
    const {reader}=discovery([{total_count:1001,workflow_runs:[run()]}]);
    await expect(reader.inspect(input)).rejects.toThrow(/incomplete|limit|truncated/i);
  });
  it("fails closed on malformed listing or a broken pagination result",async()=>{
    const {reader}=discovery([{total_count:101,workflow_runs:[run()]}]);
    await expect(reader.inspect(input)).rejects.toThrow(/incomplete|page/i);
    const {reader:bad}=discovery([{total_count:1,workflow_runs:[run({id:"fake"})]}]);
    await expect(bad.inspect(input)).rejects.toThrow();
  });
  it("uses the configured repo, workflow and bounded branch/time filters in the real GitHub REST transport",async()=>{
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({total_count:0,workflow_runs:[]}),{status:200}));
    const api=new GitHubWorkflowRunFetchApi({token:"test-only-token",fetchImpl});
    const reader=new GitHubActionsRunDiscovery(api);
    await expect(reader.inspect(input)).resolves.toEqual({status:"not_found"});
    const [requested,options]=fetchImpl.mock.calls[0]!;
    const url=new URL(requested as string);
    expect(url.pathname).toBe("/repos/example/runtime-host/actions/workflows/runtime-provider-poc-worker.yml/runs");
    expect(url.searchParams.get("event")).toBe("workflow_dispatch");
    expect(url.searchParams.get("branch")).toBe("feature/test");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(url.searchParams.get("created")).toContain("2026-10-10T01:");
    expect((options as RequestInit).headers).toMatchObject({Authorization:"Bearer test-only-token"});
    const denied=vi.fn(async()=>new Response("",{status:403}));
    await expect(new GitHubActionsRunDiscovery(new GitHubWorkflowRunFetchApi({token:"test-only-token",fetchImpl:denied})).inspect(input)).rejects.toThrow(/403/);
  });
});
