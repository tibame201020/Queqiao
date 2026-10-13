import {describe,it,expect,vi} from "vitest";
import {observeConnectorComposer} from "./connector-read-composer.js";
describe("G3.3 Composer readiness is observed once before App selection",()=>{
 it("waits for the normal UI Composer to become visible without submitting or retrying",async()=>{
  const waitForVisible=vi.fn(async()=>{});
  const actual=await observeConnectorComposer({waitForVisible,isVisible:async()=>true,isEnabled:async()=>true});
  expect(waitForVisible).toHaveBeenCalledTimes(1);
  expect(actual).toEqual({editorVisible:true,editorEnabled:true});
 });
 it("fails closed when the bounded wait never exposes a visible Composer",async()=>{
  const actual=await observeConnectorComposer({
   waitForVisible:async()=>{throw Error("timeout");},
   isVisible:async()=>false,isEnabled:async()=>true,
  });
  expect(actual).toEqual({editorVisible:false,editorEnabled:true});
 });
});
