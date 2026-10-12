import { describe, expect, it } from "vitest";
import { verifyRemoteBrowserTool, verifyRemoteBrowserReceipt } from "./poc-browser-worker-receipt.js";

const environmentId="gha_abcdef";
const marker="QUEQIAO_CI_BROWSER_HARNESS_OK";
const receipt=JSON.stringify({
 runId:"772200",origin:"https://example.com",pageTitle:"Example Domain",
 interactiveMarker:marker,clicks:1,inputEcho:"CI-only-synthetic-input",headless:true,
});
function routed(text:string, badEnv=environmentId){
 return {content:[{type:"text",text}],_meta:{"dev.queqiao/routing":{environmentId:badEnv}}};
}
describe("Actions Gateway -> Worker -> Browser Harness receipt contract",()=>{
 it("checks actual Worker routed process output, not just an echoed marker",()=>{
  const value=JSON.stringify({workspaceId:"runtime",executable:"node",exitCode:0,
   stdout:marker,stderr:"",outputLimitExceeded:false});
  expect(verifyRemoteBrowserTool(routed(value),environmentId)).toEqual({routed:true});
 });
 it("refuses failed process, wrong Worker, missing and truncated output",()=>{
  const value=JSON.stringify({workspaceId:"runtime",executable:"node",exitCode:1,stdout:marker,outputLimitExceeded:false});
  expect(()=>verifyRemoteBrowserTool(routed(value),environmentId)).toThrow();
  expect(()=>verifyRemoteBrowserTool(routed(value,"another"),environmentId)).toThrow();
  expect(()=>verifyRemoteBrowserTool(routed(marker),environmentId)).toThrow();
 });
 it("requires real worker GitHub Run ID and browser JSON receipt",()=>{
  const lines="Workspace: runtime\nPath: ci-browser-receipt.json\nLines: 1-1 of 1\n\n"+receipt;
  expect(verifyRemoteBrowserReceipt(routed(lines),environmentId,"772200")).toMatchObject({
   runId:"772200",interactiveMarker:marker,clicks:1,
  });
 });
 it("accepts Worker read_file with a trailing blank line counted in total lines",()=>{
  const lines="Workspace: runtime\nPath: ci-browser-receipt.json\nLines: 1-1 of 2\n\n"+receipt;
  expect(verifyRemoteBrowserReceipt(routed(lines),environmentId,"772200")).toMatchObject({
   runId:"772200",clicks:1,
  });
 }); it("rejects incorrect Run ID, forged marker, or wrong routed environment",()=>{
  const lines="Workspace: runtime\nPath: ci-browser-receipt.json\nLines: 1-1 of 1\n\n"+receipt;
  expect(()=>verifyRemoteBrowserReceipt(routed(lines),environmentId,"9999")).toThrow();
  expect(()=>verifyRemoteBrowserReceipt(routed(lines,"wrong"),environmentId,"772200")).toThrow();
  expect(()=>verifyRemoteBrowserReceipt(routed(lines.replace(marker,"BAD")),environmentId,"772200")).toThrow();
 });
});
