import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const root="packages/browser-harness-runtime/src/";
const control=readFileSync(root+"session-control.ts","utf8");
const acceptance=readFileSync(root+"session-acceptance.ts","utf8");
const workflow=readFileSync(".github/workflows/browser-harness-session-portability.yml","utf8");
describe("same Runner HTTP diagnostics are attached without reading private session fields",()=>{
 it("captures first-party HTTP status and document navigation for both contexts",()=>{
   for(const src of [control,acceptance]){
     expect(src).toContain("createHttpDiagnostics()");
     expect(src).toContain('page.on("response"');
     expect(src).toContain("summarizeNavigation(");
   }
 });
 it("adds only aggregate Cookie expiry buckets to restored-context results",()=>{
   expect(acceptance).toContain("summarizeCookieExpiry(state.cookies,Date.now())");
   expect(acceptance).not.toContain("console.log(state)");
 });
 it("maintains existing Secret only in main manual gate, no diagnostics artifacts",()=>{
   expect(workflow).toContain("github.ref == 'refs/heads/main'");
   expect(workflow).not.toContain("actions/upload-artifact@");
 });
});
