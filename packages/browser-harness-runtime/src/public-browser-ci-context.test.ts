import { describe,expect,it } from "vitest";
import { resolvePublicBrowserCIContext } from "./public-browser-ci-context.js";

describe("isolated browser Worker CI correlation context",()=>{
 it("prefers real Actions env without reading any local metadata",()=>{
  expect(resolvePublicBrowserCIContext({GITHUB_RUN_ID:"12345"},undefined)).toEqual({runId:"12345"});
 });
 it("accepts only trusted synthetic Workflow metadata if Worker sanitizes environment",()=>{
  expect(resolvePublicBrowserCIContext({},'{"runId":"772211"}')).toEqual({runId:"772211"});
 });
 it.each(['{"runId":"abc"}','{"runId":"42","session":"private"}',
  '{"runId":123}','{"runId":"-1"}','{}'])("rejects bad metadata without fallback: %s",raw=>{
  expect(()=>resolvePublicBrowserCIContext({},raw)).toThrow();
 });
 it("does not treat missing CI identity as success",()=>{
  expect(()=>resolvePublicBrowserCIContext({},undefined)).toThrow();
 });
});
