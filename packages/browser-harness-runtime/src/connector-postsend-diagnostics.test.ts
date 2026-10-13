import {describe,it,expect} from "vitest";
import {classifyConnectorPostsendState,type ConnectorPostsendSignals} from "./connector-postsend-diagnostics.js";
const empty:ConnectorPostsendSignals={
 userTurnVisible:false,assistantSurfaceVisible:false,stopVisible:false,
 composerEnabled:false,dialogVisible:false,
};
describe("G3.3 sanitized post-send observation is diagnostic, never proof",()=>{
 it("keeps uncertain submission fail closed",()=>{
  expect(classifyConnectorPostsendState(empty)).toBe("user_turn_unconfirmed");
 });
 it("distinguishes no Assistant, generation busy, modal, and visible Assistant UI",()=>{
  expect(classifyConnectorPostsendState({...empty,userTurnVisible:true})).toBe("user_turn_without_assistant");
  expect(classifyConnectorPostsendState({...empty,userTurnVisible:true,assistantSurfaceVisible:true}))
    .toBe("assistant_surface_without_tool");
  expect(classifyConnectorPostsendState({...empty,userTurnVisible:true,stopVisible:true}))
    .toBe("generation_in_progress");
  expect(classifyConnectorPostsendState({...empty,userTurnVisible:true,dialogVisible:true}))
    .toBe("dialog_observed");
 });
 it("never equates Assistant or an enabled Composer with connector success",()=>{
  expect(classifyConnectorPostsendState({...empty,userTurnVisible:true,assistantSurfaceVisible:true,composerEnabled:true}))
    .not.toBe("verified");
  expect(Object.keys(empty)).toEqual(["userTurnVisible","assistantSurfaceVisible","stopVisible","composerEnabled","dialogVisible"]);
 });
});
