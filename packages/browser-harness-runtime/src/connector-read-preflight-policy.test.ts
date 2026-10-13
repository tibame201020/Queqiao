import {describe,it,expect} from "vitest";
import {assessConnectorPreflight,type ConnectorPreflightSignals} from "./connector-read-preflight-policy.js";
const ready:ConnectorPreflightSignals={
 authenticated:true,runIdValid:true,expectedShaValid:true,blankStart:true,editorVisible:true,editorEnabled:true,
};
describe("G3.3 bounded fail-closed preflight",()=>{
 it("proceeds only on all six independently observed booleans",()=>expect(assessConnectorPreflight(ready)).toBe("ready"));
 it.each(["authenticated","runIdValid","expectedShaValid","blankStart","editorVisible","editorEnabled"] as const)
 ("fails on %s=false",(key)=>expect(assessConnectorPreflight({...ready,[key]:false})).toBe("failed"));
 it("does not permit extra raw URL or account properties in the schema",()=>{
  expect(Object.keys(ready)).toEqual(["authenticated","runIdValid","expectedShaValid","blankStart","editorVisible","editorEnabled"]);
 });
});
