import { describe,expect,it } from "vitest";
import { summarizeSessionEvidence } from "./session-auth-evidence.js";
describe("read-only session evidence is sanitized and fail closed",()=>{
  it("confirms only a successful JSON user session",()=>{
    expect(summarizeSessionEvidence(200,"application/json",{user:{id:"SENSITIVE-ID",name:"secret"},accessToken:"SENSITIVE-TOKEN"}))
      .toEqual({sessionConfirmed:true,check:"confirmed"});
  });
  it.each([
    [200,"application/json",null],
    [200,"application/json",{}],
    [200,"application/json",{user:{}}],
    [200,"application/json",{user:{id:""}}],
    [200,"text/html",{user:{id:"id"}}],
    [403,"application/json",{user:{id:"id"}}],
  ] as const)("does not claim authenticated without usable evidence %#",(status,contentType,payload)=>{
    expect(summarizeSessionEvidence(status,contentType,payload).sessionConfirmed).toBe(false);
  });
  it("never returns tokens, identities or raw session response",()=>{
    const result=summarizeSessionEvidence(200,"application/json",{user:{id:"SENSITIVE-ID"},accessToken:"SENSITIVE-TOKEN"});
    expect(JSON.stringify(result)).not.toMatch(/SENSITIVE/);
  });
});
