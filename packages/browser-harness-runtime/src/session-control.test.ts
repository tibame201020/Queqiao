import { describe, expect, it } from "vitest";
import { assessSessionComparison, type ControlResult } from "./session-control.js";
import type { SessionPageVerdict } from "./session-verdict.js";

function compare(control:ControlResult, restored:SessionPageVerdict) {
  return assessSessionComparison(control,restored);
}
describe("isolated CI ChatGPT control and restored-context comparison",()=>{
 it("reports both contexts challenged, not proof of a bad capsule or successful login",()=>{
  expect(compare({verdict:"browser_challenge",isolated:true},"browser_challenge"))
    .toBe("both_contexts_challenged");
 });
 it("distinguishes restored-only challenge without inventing a root cause",()=>{
  expect(compare({verdict:"logged_out",isolated:true},"browser_challenge"))
    .toBe("restored_only_challenged");
 });
 it("recognizes actual authenticated composer without treating clean-context challenge as proof",()=>{
  expect(compare({verdict:"browser_challenge",isolated:true},"authenticated"))
    .toBe("authenticated_composer");
 });
 it("treats navigation errors and pending page as inconclusive",()=>{
  expect(compare({verdict:"navigation_error",isolated:true},"browser_challenge")).toBe("inconclusive");
  expect(compare({verdict:"pending",isolated:true},"browser_challenge")).toBe("inconclusive");
 });
 it("accepts a guest composer as evidence of an unauthenticated control, not login",()=>{
  expect(compare({verdict:"guest_composer",isolated:true},"browser_challenge")).toBe("restored_only_challenged");
  expect(compare({verdict:"guest_composer",isolated:true},"guest_composer")).toBe("not_authenticated");
 });
 it("fails closed if isolated context has any pre-existing storage or appears authenticated",()=>{
  expect(()=>compare({verdict:"logged_out",isolated:false},"browser_challenge")).toThrow(/isolation/i);
  expect(()=>compare({verdict:"authenticated",isolated:true},"browser_challenge")).toThrow(/isolation/i);
 });
});
