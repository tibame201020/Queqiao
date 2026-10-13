import {describe,it,expect} from "vitest";
import {assessGate3Preflight} from "./gate3-preflight.js";
const ready={sessionConfirmed:true,blankStart:true,editorVisible:true,editorEnabled:true};
describe("Gate 3 preflight semantic diagnosis without URL or browser content",()=>{
 it("only proceeds after all four independently observed signals",()=>expect(assessGate3Preflight(ready)).toBe("ready"));
 it.each([
  [{sessionConfirmed:false},"not_authenticated"],
  [{blankStart:false},"not_blank"],
  [{editorVisible:false},"composer_hidden"],
  [{editorEnabled:false},"composer_disabled"],
 ] as const)("fails closed on %j", (delta,code)=>{
  expect(assessGate3Preflight({...ready,...delta})).toBe(code);
 });
});
