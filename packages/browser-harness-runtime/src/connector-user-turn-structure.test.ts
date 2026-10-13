import {describe,it,expect} from "vitest";
import {classifyUserTurnStructure,type UserTurnStructureSignals} from "./connector-user-turn-structure.js";
const signals:UserTurnStructureSignals={
 conversationCreated:true,
 userRoleVisible:true,
 middleInUserRole:true,
 tailInUserRole:true,
 middleOutsideEditor:true,
 tailOutsideEditor:true,
 assistantOwnedFragment:false,
 composerRetainsTail:false,
};
describe("G3.3 user-message structure (no raw DOM or text export)",()=>{
 it("accepts a native user-owned rendered turn with independent middle and tail fragments",()=>{
  expect(classifyUserTurnStructure(signals)).toBe("user_turn_confirmed");
 });
 it("rejects an unrelated user container or an Assistant-owned fragment",()=>{
  expect(classifyUserTurnStructure({...signals,middleInUserRole:false})).toBe("unconfirmed");
  expect(classifyUserTurnStructure({...signals,assistantOwnedFragment:true})).toBe("unconfirmed");
 });
 it("never accepts partial content merely seen outside the Composer",()=>{
  expect(classifyUserTurnStructure({...signals,userRoleVisible:false,middleInUserRole:false,tailInUserRole:false})).toBe("unconfirmed");
 });
 it("fails closed on an uncleared draft or missing conversation",()=>{
  expect(classifyUserTurnStructure({...signals,composerRetainsTail:true})).toBe("unconfirmed");
  expect(classifyUserTurnStructure({...signals,conversationCreated:false})).toBe("unconfirmed");
 });
 it("uses only an explicit bounded non-identifying signal set",()=>{
  expect(Object.keys(signals)).toEqual([
   "conversationCreated","userRoleVisible","middleInUserRole","tailInUserRole",
   "middleOutsideEditor","tailOutsideEditor","assistantOwnedFragment","composerRetainsTail",
  ]);
 });
});
