import {describe,it,expect} from "vitest";
import {assessConnectorUserTurn,type ConnectorUserTurnSignals} from "./connector-user-turn.js";
const confirmed:ConnectorUserTurnSignals={
 conversationCreated:true,promptEchoOutsideEditor:true,promptStillInEditor:false,
};
describe("G3.3 requires independently observed user turn before tool check",()=>{
 it("accepts one real displayed turn with cleared composer and conversation",()=>{
  expect(assessConnectorUserTurn(confirmed)).toBe("confirmed");
 });
 it.each(["conversationCreated","promptEchoOutsideEditor"] as const)
 ("fails closed without %s",(key)=>{
  expect(assessConnectorUserTurn({...confirmed,[key]:false})).toBe("unconfirmed");
 });
 it("does not confuse a still-typed draft with submitted turn",()=>{
  expect(assessConnectorUserTurn({...confirmed,promptStillInEditor:true})).toBe("unconfirmed");
 });
});
