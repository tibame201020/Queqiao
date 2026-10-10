import { describe, expect, it, vi } from "vitest";
import { GitHubRecoveryRestApi } from "./recovery-rest.js";

const record={
 id:8001,name:"Runtime Provider POC Worker",workflow_id:99,
 repository:{full_name:"example/runtime-host"},
 path:".github/workflows/runtime.yml",head_branch:"main",
 event:"workflow_dispatch",actor:{login:"trusted-bot"},
 display_title:"Queqiao Runtime 11111111-1111-4111-8111-111111111111",
 run_attempt:1,status:"in_progress",conclusion:null,
};
describe("bounded GitHub REST verified-run recovery transport",()=>{
 it("GETs the exact Run and maps its identity; requests cancellation separately",async()=>{
  const fetchImpl=vi.fn(async (_url:unknown,options:RequestInit)=>
    options.method==="GET"
      ?new Response(JSON.stringify(record),{status:200})
      :new Response("",{status:202}));
  const client=new GitHubRecoveryRestApi({token:"test-token-only",fetchImpl});
  expect(await client.get("example","runtime-host",8001)).toMatchObject({
    id:8001,workflow:"runtime.yml",repository:"example/runtime-host",
    actor:"trusted-bot",status:"in_progress",conclusion:null,
  });
  await client.cancel("example","runtime-host",8001);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/example/runtime-host/actions/runs/8001");
  expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://api.github.com/repos/example/runtime-host/actions/runs/8001/cancel");
  expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({method:"POST",
    headers:expect.objectContaining({Authorization:"Bearer test-token-only"})});
 });
 it("does not treat a failed cancellation request or malformed GET as disposal",async()=>{
  const denied=new GitHubRecoveryRestApi({token:"test",fetchImpl:vi.fn(async()=>new Response("",{status:403}))});
  await expect(denied.cancel("example","runtime-host",8001)).rejects.toThrow(/403/);
  const malformed=new GitHubRecoveryRestApi({token:"test",fetchImpl:vi.fn(async()=>new Response(JSON.stringify({...record,id:"spoofed"}),{status:200}))});
  await expect(malformed.get("example","runtime-host",8001)).rejects.toThrow();
 });
});
