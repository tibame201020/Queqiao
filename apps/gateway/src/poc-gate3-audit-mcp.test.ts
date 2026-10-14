import express from "express";
import type {Server} from "node:http";
import {Client,StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import {describe,it,expect} from "vitest";
import {createMcpNodeAdapter} from "./mcp-adapter.js";
import type {WorkerRegistry} from "./worker-registry.js";
import type {Gate3McpAuditRead} from "./poc-gate3-audit-read.js";
import {McpCancellationRegistry} from "./cancellation-registry.js";
async function withClient(service:Gate3McpAuditRead|undefined,principal:string,run:(client:Client)=>Promise<void>){
 const workers={} as WorkerRegistry;
 const adapter=createMcpNodeAdapter(workers,["queqiao:access"],{
  principalId:principal,registry:new McpCancellationRegistry(),
 },[],undefined,undefined,service);
 const app=express();app.use(express.json());
 app.post("/mcp",(req,res)=>{void adapter.handle(req,res,req.body);});
 const server:Server=app.listen(0,"127.0.0.1");
 await new Promise<void>(resolve=>server.once("listening",resolve));
 const address=server.address();if(!address||typeof address==="string")throw Error("invalid_address");
 const client=new Client({name:"gate3-audit-contract",version:"1"},{
  supportedProtocolVersions:["2025-11-25"],versionNegotiation:{mode:"legacy"},
 });
 const transport=new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
 try{await client.connect(transport);await run(client);}finally{
  await client.close();await adapter.close();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
}
describe("G3.3 custom MCP opt-in tools/call boundary",()=>{
 it("is absent unless a trusted Gateway process explicitly injected the service",async()=>{
  await withClient(undefined,"authorized-client",async(client)=>{
   expect((await client.listTools()).tools.some(t=>t.name==="gate3_read_artifact")).toBe(false);
  });
 });
 it("routes one read-only request to the server service with the authenticated OAuth principal, no user-controlled binding",async()=>{
  let principal="",calls=0;
  const service={execute:async(p:string)=>{principal=p;calls++;return {serverOriginated:true};}} as Gate3McpAuditRead;
  await withClient(service,"authorized-client",async(client)=>{
   const tool=(await client.listTools()).tools.find(t=>t.name==="gate3_read_artifact");
   expect(tool?.annotations?.readOnlyHint).toBe(true);
   const response=await client.callTool({name:"gate3_read_artifact",arguments:{}});
   expect(response.isError).not.toBe(true);
   expect(JSON.stringify(response.content)).toContain("serverOriginated");
  });
  expect([principal,calls]).toEqual(["authorized-client",1]);
 });
 it("rejects missing authenticated principal before invoking the service",async()=>{
  let calls=0;const service={execute:async()=>{calls++;return {};}} as unknown as Gate3McpAuditRead;
  await withClient(service,"",async(client)=>{
   const response=await client.callTool({name:"gate3_read_artifact",arguments:{}});
   expect(response.isError).toBe(true);
  });
  expect(calls).toBe(0);
 });
});
