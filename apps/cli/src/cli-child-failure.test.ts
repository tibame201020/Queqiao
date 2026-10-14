import {describe,it,expect} from "vitest";
import {describePackagedCliFailure} from "./cli-child-failure.js";
describe("packaged CLI child failure classification",()=>{
 it("identifies bounded exec timeout without leaking any child error text, paths or tokens",()=>{
  const e=Object.assign(new Error("C:\\Users\\someone\\private-token"),{code:null,killed:true,signal:"SIGTERM",stdout:"private",stderr:"secret"});
  const msg=describePackagedCliFailure(["restart","--json"],e);
  expect(msg).toContain("command=restart");
  expect(msg).toContain("kind=timeout");
  expect(msg).toContain("stdoutBytes=7");
  expect(msg).toContain("stderrBytes=6");
  expect(msg).not.toMatch(/private|secret|someone|Users/);
 });
 it("distinguishes a nonzero child exit from timeout, and sanitizes command arguments",()=>{
  const e=Object.assign(new Error("token abc"),{code:1,killed:false,signal:null,stdout:"",stderr:"fail"});
  expect(describePackagedCliFailure(["restart","--join-code","credential"],e)).toMatch(/command=restart;kind=exit;code=1/);
  expect(describePackagedCliFailure(["restart","--join-code","credential"],e)).not.toContain("credential");
 });
 it("does not assume unknown exceptions are timeouts",()=>{
  expect(describePackagedCliFailure(["worker","status"],new Error("x"))).toContain("kind=unknown");
 });
});
