import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const source=readFileSync("packages/browser-harness-runtime/src/session-acceptance.ts","utf8");
const probe=readFileSync("packages/browser-harness-runtime/src/session-restored-control.ts","utf8");
describe("single bounded CI restore-context comparison policy",()=>{
 it("runs only after normal guest control and a restored-context challenge",()=>{
  expect(source).toContain('if(verdict==="browser_challenge" && control.verdict==="guest_composer")');
  expect(source).toContain("probeRestoredContext(browser,state,installLocalStorage)");
  expect(source).toContain("restoredContextError=true");
 });
 it("new Context is empty, closes always, and never retries or clicks challenges",()=>{
  expect(probe).toContain('browser.newContext({storageState:{cookies:[],origins:[]}})');
  expect(probe).toContain("await context.close()");
  expect(probe).not.toMatch(/console\.log\(|\.screenshot\(|\.click\(|proxy|rotate|webdriver/i);
 });
});
