import {describe,it,expect} from "vitest";
import {assessAbControlPreflight,type AbControlPreflightSignals} from "./ab-control-preflight.js";
const good:AbControlPreflightSignals={authenticated:true,blankStart:true,editorVisible:true,editorEnabled:true};
describe("G3.3 A1 no-App control fails closed before any send",()=>{
 it("accepts only all observed normal UI readiness signals",()=>expect(assessAbControlPreflight(good)).toBe("ready"));
 it.each(["authenticated","blankStart","editorVisible","editorEnabled"] as const)
 ("rejects %s=false",(key)=>expect(assessAbControlPreflight({...good,[key]:false})).toBe("failed"));
 it("exposes fixed non-identifying bool-only signals",()=>expect(Object.keys(good))
  .toEqual(["authenticated","blankStart","editorVisible","editorEnabled"]));
});
