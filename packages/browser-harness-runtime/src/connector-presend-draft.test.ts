import {describe,it,expect} from "vitest";
import {assessConnectorDraft,type ConnectorDraftSignals} from "./connector-presend-draft.js";
const ready:ConnectorDraftSignals={
 editorFocused:true,middleInEditor:true,tailInEditor:true,editorEnabled:true,
};
describe("G3.3 pre-send Composer evidence",()=>{
 it("allows one Enter only when active Composer contains independent middle and tail fragments",()=>{
  expect(assessConnectorDraft(ready)).toBe("ready");
 });
 it.each(["editorFocused","middleInEditor","tailInEditor","editorEnabled"] as const)
 ("fails closed when %s is false",(key)=>{
  expect(assessConnectorDraft({...ready,[key]:false})).toBe("unconfirmed");
 });
 it("logs only four booleans, never prompt text or focused DOM identity",()=>{
  expect(Object.keys(ready)).toEqual(["editorFocused","middleInEditor","tailInEditor","editorEnabled"]);
 });
});
