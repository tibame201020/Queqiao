import {describe,expect,it} from "vitest";
import {compareRestoredContexts, type RestoredContextProbe} from "./session-restored-control.js";
const sample:RestoredContextProbe={
 verdict:"browser_challenge",
 navigation:{outcome:"response",status:403,redirects:1,destination:"chatgpt"},
 cookies:{source:2,eligible:1,expired:1,matched:1,missing:0,changed:0},
 localStorage:{expected:1,observed:1,matched:1,status:"observed"},
 http:{total:4,success:2,redirect:1,unauthorized:0,forbidden:1,rateLimited:0,other4xx:0,serverError:0,other:0},
};
describe("bounded same Chrome restored Context comparison",()=>{
 it("distinguishes consistent HTTP403 challenges without inventing the cause",()=>{
   expect(compareRestoredContexts("browser_challenge",403,sample)).toBe("both_restored_contexts_challenged");
 });
 it("distinguishes default-context-only challenge",()=>{
   expect(compareRestoredContexts("browser_challenge",403,{
    ...sample,verdict:"guest_composer",navigation:{...sample.navigation,status:200},
   })).toBe("default_context_only_challenged");
 });
 it("does not claim login on guest Composer or navigation failure",()=>{
   expect(compareRestoredContexts("browser_challenge",403,{
    ...sample,verdict:"navigation_error",navigation:{...sample.navigation,status:null,outcome:"navigation_error"},
   })).toBe("inconclusive");
 });
 it("only an independently verified authenticated result can be called authenticated",()=>{
   expect(compareRestoredContexts("browser_challenge",403,{
    ...sample,verdict:"authenticated",navigation:{...sample.navigation,status:200},
   })).toBe("isolated_context_authenticated");
 });
});
