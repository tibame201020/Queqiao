import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {makeReadMarker,makeReadPrompt,assessReadLayers,shouldReloadConversation} from "./connector-layered-proof.js";
const sha="e0c3c1094b692b48ff1e24ef8338594f573fa72f";
const good={
 appSelected:true,conversationCreated:true,markerOutsideComposer:true,composerCleared:true,
 reply:sha,replyOutsideUserAndComposer:true,replyStable:true,expectedSha:sha,
 toolUiObserved:false,providerReceiptVerified:false,
};
describe("G3.3 layered read-only POC",()=>{
 it("creates a public run-specific marker without changing SHA-only reply contract",()=>{
  expect(makeReadMarker("38393395432","1")).toBe("QG3-38393395432-1");
  expect(makeReadPrompt("QG3-38393395432-1")).toContain("Trace marker: QG3-38393395432-1.");
  expect(makeReadPrompt("QG3-38393395432-1")).toContain("Reply with ONLY the exact 40 lowercase hexadecimal characters");
  expect(()=>makeReadMarker("test-secret","1")).toThrow();
 });
 it("can verify L1 and L2 while retaining L3 as not proved, including a split native @mention",()=>{
  expect(assessReadLayers(good)).toEqual({l1:"confirmed",l2:"confirmed",l3:"not_proved",toolUiObserved:false});
  expect(assessReadLayers({...good,toolUiObserved:true})).toEqual({l1:"confirmed",l2:"confirmed",l3:"not_proved",toolUiObserved:true});
 });
 it("refuses a reply without the uniquely correlated USER marker, even if SHA matches",()=>{
  expect(assessReadLayers({...good,markerOutsideComposer:false})).toMatchObject({l1:"unconfirmed",l2:"unconfirmed",l3:"not_proved"});
  expect(assessReadLayers({...good,composerCleared:false})).toMatchObject({l1:"unconfirmed",l2:"unconfirmed"});
  expect(assessReadLayers({...good,replyOutsideUserAndComposer:false})).toMatchObject({l2:"unconfirmed"});
 });
 it("refuses a wrong or incomplete SHA, and a still-generating answer",()=>{
  expect(assessReadLayers({...good,reply:"0".repeat(40)})).toMatchObject({l2:"unconfirmed",l3:"not_proved"});
  expect(assessReadLayers({...good,reply:"UNAVAILABLE"})).toMatchObject({l2:"unconfirmed"});
  expect(assessReadLayers({...good,replyStable:false})).toMatchObject({l2:"unconfirmed"});
 });
 it("a provider proof is necessary but not sufficient unless L1 and L2 also pass",()=>{
  expect(assessReadLayers({...good,providerReceiptVerified:true})).toMatchObject({l3:"verified"});
  expect(assessReadLayers({...good,markerOutsideComposer:false,providerReceiptVerified:true})).toMatchObject({l3:"not_proved"});
 });
 it("allows only one normal conversation reload when settled and same URL, never a resend",()=>{
  const base={conversationCreated:true,reloaded:false,generating:false,composerReady:true,sameConversationUrl:true};
  expect(shouldReloadConversation(base)).toBe(true);
  expect(shouldReloadConversation({...base,reloaded:true})).toBe(false);
  expect(shouldReloadConversation({...base,generating:true})).toBe(false);
  expect(shouldReloadConversation({...base,sameConversationUrl:false})).toBe(false);
  expect(shouldReloadConversation({...base,conversationCreated:false})).toBe(false);
 });
 it("source keeps one normal send, a single bounded same-conversation reload, no tool replay or write",()=>{
  const code=readFileSync("packages/browser-harness-runtime/src/connector-read-preflight.ts","utf8");
  expect(code.match(/editor\.press\("Enter"\)/g)).toHaveLength(1);
  expect(code.match(/page\.reload\(/g)).toHaveLength(1);
  expect(code).toContain('providerReceiptVerified:false');
  expect(code).not.toMatch(/fetch\(|route\(|request\.post|gh pr create|git push|page\.screenshot\(/);
 });

});
