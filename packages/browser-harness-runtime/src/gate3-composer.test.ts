import {describe,it,expect,vi} from "vitest";
import {observeGate3Composer} from "./gate3-composer.js";
describe("Gate 3 bounded semantic Composer readiness",()=>{
 it("waits for visible editor before evaluating enabled state",async()=>{
  let visible=false;
  const waitForVisible=vi.fn(async()=>{visible=true;});
  const observed=await observeGate3Composer({
   waitForVisible,isVisible:async()=>visible,isEnabled:async()=>true,
  });
  expect(waitForVisible).toHaveBeenCalledTimes(1);
  expect(observed).toEqual({editorVisible:true,editorEnabled:true});
 });
 it("fails closed when bounded visible wait times out",async()=>{
  const observed=await observeGate3Composer({
   waitForVisible:async()=>{throw Error("raw private browser error");},
   isVisible:async()=>false,isEnabled:async()=>true,
  });
  expect(observed).toEqual({editorVisible:false,editorEnabled:true});
  expect(JSON.stringify(observed)).not.toContain("private");
 });
 it("fails closed if visible but disabled",async()=>{
  expect(await observeGate3Composer({
   waitForVisible:async()=>{},isVisible:async()=>true,isEnabled:async()=>false,
  })).toEqual({editorVisible:true,editorEnabled:false});
 });
});
