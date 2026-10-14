import {describe,it,expect,vi} from "vitest";
import {Gate3CustomMcpRead, type Gate3CustomMcpContext} from "./gate3-custom-mcp-read.js";
const context:Gate3CustomMcpContext={
 controllerRunId:"123456",controllerAttempt:"1",workerRunId:"123457",
 environmentId:"gha_1234567890abcdef",leaseId:"11111111-1111-4111-8111-111111111111",
 taskId:"gate3-123457-1",expectedSha:"a".repeat(40),
};
function fixture(){
 const events:any[]=[];
 const append=vi.fn(async(event:any)=>{events.push(event);});
 const audit={append};
 const fetchImpl=vi.fn(async (_url:RequestInfo|URL,_opts?:RequestInit)=>new Response(JSON.stringify({commit:{sha:"a".repeat(40)}}),{status:200}));
 const svc=new Gate3CustomMcpRead(context,audit,fetchImpl as typeof fetch);
 return {events,audit,append,fetchImpl,svc};
}
describe("server-origin Gate3 custom MCP read-only audit",()=>{
 it("performs exactly one allowlisted public GET and appends event BEFORE returning a success receipt",async()=>{
  const {svc,events,audit,fetchImpl}=fixture();
  const p=svc.readHead("oauth-client-a");
  const result=await p;
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url,opts]=fetchImpl.mock.calls[0]!;
  expect(url).toBe("https://api.github.com/repos/tibame201020/Queqiao/branches/main");
  expect(opts?.method).toBe("GET");
  expect(result).toMatchObject({schema:"queqiao.gate3.custom-mcp-read.v1",provider:"queqiao_custom_mcp",
   controllerRunId:"123456",workerRunId:"123457",taskId:"gate3-123457-1",resultSha:"a".repeat(40),verified:true});
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({component:"gateway",category:"tool",action:"gate3.custom-mcp-read",
   outcome:"success",detail:{runId:"123456",tool:"gate3_read_public_head"}});
  expect(result.auditEventId).toBe(events[0].id);
  expect(JSON.stringify(result)+JSON.stringify(events)).not.toContain("oauth-client-a");
 });
 it("fails closed when the independent GitHub result mismatches the pinned expected sha",async()=>{
  const {svc,append,fetchImpl}=fixture();
  fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({commit:{sha:"b".repeat(40)}}),{status:200}));
  await expect(svc.readHead("oauth-client-a")).rejects.toThrow(/G3_CUSTOM_MCP_READ_/);
  expect(append).toHaveBeenCalledTimes(1);
  expect(append.mock.calls[0]![0]).toMatchObject({outcome:"failed"});
 });
 it("never emits success if durable audit append fails",async()=>{
  const {svc,append}=fixture();append.mockRejectedValueOnce(new Error("disk full"));
  await expect(svc.readHead("oauth-client-a")).rejects.toThrow(/G3_CUSTOM_MCP_AUDIT_FAILED/);
 });
 it("refuses a missing authenticated principal before any outbound network or event",async()=>{
  const {svc,audit,fetchImpl}=fixture();
  await expect(svc.readHead("")).rejects.toThrow(/G3_CUSTOM_MCP_UNAUTHORIZED/);
  expect(fetchImpl).not.toHaveBeenCalled();expect(append).not.toHaveBeenCalled();
 });
 it("refuses invalid server-trusted same-task metadata rather than trusting a supplied verified flag",()=>{
  const {audit,fetchImpl}=fixture();
  expect(()=>new Gate3CustomMcpRead({...context,taskId:"gate3-other-1"},audit,fetchImpl as typeof fetch))
   .toThrow(/G3_CUSTOM_MCP_CONTEXT_INVALID/);
 });
});
