import {describe,expect,it} from "vitest";
import {
  summarizeNavigation,createHttpDiagnostics,summarizeCookieExpiry,
  type NavigationResponse,type NavigationRequest,
} from "./session-http-diagnostics.js";
import type {BrowserSessionCookie} from "./session-capsule.js";

function response(url:string,status:number,previous:NavigationResponse|null=null):NavigationResponse{
  return {url:()=>url,status:()=>status,request:()=>({
    redirectedFrom:()=>previous?.request()??null,
  })};
}
function cookie(expires:number):BrowserSessionCookie{
  return {name:"DO_NOT_LEAK_COOKIE_NAME",value:"DO_NOT_LEAK_TOKEN",domain:".chatgpt.com",
    path:"/private",expires,httpOnly:true,secure:true,sameSite:"Lax"};
}
describe("credential-free browser HTTP and expiry diagnostics",()=>{
 it("retains document status, redirect count and safe destination class, never URL path",()=>{
  const initial=response("https://chatgpt.com/start?private=DO_NOT_LEAK_TOKEN",302);
  const final=response("https://chatgpt.com/sensitive/path?secret=DO_NOT_LEAK_TOKEN",403,initial);
  const result=summarizeNavigation(final);
  expect(result).toEqual({outcome:"response",status:403,redirects:1,destination:"chatgpt"});
  expect(JSON.stringify(result)).not.toMatch(/DO_NOT_LEAK|sensitive|private|start|secret/);
 });
 it("classifies untrusted navigation host without exposing its name",()=>{
  expect(summarizeNavigation(response("https://id.example.invalid/user-private",429)).destination).toBe("other");
  expect(summarizeNavigation(null)).toEqual({outcome:"no_response",status:null,redirects:0,destination:"unknown"});
 });
 it("bounds redirect count even for a malicious redirect cycle",()=>{
  const req:NavigationRequest={redirectedFrom:()=>req};
  const r:NavigationResponse={url:()=>"https://chatgpt.com/",status:()=>200,request:()=>req};
  expect(summarizeNavigation(r).redirects).toBe(1);
 });
 it("collects HTTP status classes only for first-party hosts, never URLs or bodies",()=>{
  const c=createHttpDiagnostics();
  c.observe("https://chatgpt.com/private?token=DO_NOT_LEAK_TOKEN",200);
  c.observe("https://chatgpt.com/anything",403);
  c.observe("https://auth.openai.com/sensitive",429);
  c.observe("https://chatgpt.com/other",500);
  c.observe("https://evilchatgpt.com/fake",401);
  expect(c.snapshot()).toEqual({total:4,success:1,redirect:0,
    unauthorized:0,forbidden:1,rateLimited:1,other4xx:0,serverError:1,other:0});
  expect(JSON.stringify(c.snapshot())).not.toMatch(/DO_NOT_LEAK|private|sensitive|anything/);
 });
 it("categorizes expired, session and soon-expiring cookies without exposing identities",()=>{
  const now=1_790_000_000_000;
  const sec=now/1000;
  const result=summarizeCookieExpiry([
    cookie(-1),cookie(0),cookie(sec-1),cookie(sec+1),cookie(sec+86400),
    cookie(sec+86401),cookie(sec+8*86400),
  ],now);
  expect(result).toEqual({source:7,session:2,expired:1,within24h:2,within7d:1,beyond7d:1});
  expect(JSON.stringify(result)).not.toMatch(/DO_NOT_LEAK|chatgpt|private/);
 });
});
