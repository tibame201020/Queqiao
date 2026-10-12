import {describe, expect, it} from "vitest";
import {decodeBrowserSessionCapsule} from "./session-capsule.js";
import {prepareRenewedCapsule, assertAttendedLogin, type BrowserSnapshot} from "./session-renewal.js";

const goodCookie={
 name:"DO_NOT_LOG_COOKIE_NAME",value:"DO_NOT_LOG_SECRET",domain:".chatgpt.com",path:"/",
 expires:1893456000,httpOnly:true,secure:true,sameSite:"Lax" as const,
};
const sample:BrowserSnapshot={
 cookies:[goodCookie,{...goodCookie,name:"thirdParty",domain:".elsewhere.invalid"}],
 origins:[
  {origin:"https://chatgpt.com",localStorage:[{name:"DO_NOT_LOG_KEY",value:"DO_NOT_LOG_STORAGE"}]},
  {origin:"https://other.invalid",localStorage:[{name:"thirdParty",value:"private"}]},
 ],
};
describe("attended session renewal preflight",()=>{
 it("requires a confirmed local service session and usable Composer",()=>{
  expect(()=>assertAttendedLogin({sessionConfirmed:true,check:"confirmed"},true,false)).not.toThrow();
  expect(()=>assertAttendedLogin({sessionConfirmed:false,check:"not_confirmed"},true,false)).toThrow();
  expect(()=>assertAttendedLogin({sessionConfirmed:true,check:"confirmed"},false,false)).toThrow();
  expect(()=>assertAttendedLogin({sessionConfirmed:true,check:"confirmed"},true,true)).toThrow();
 });
 it("only captures explicitly allowlisted browser state and round-trips with existing decoder",()=>{
  const {capsule,summary}=prepareRenewedCapsule(sample,1780000000000);
  const restored=decodeBrowserSessionCapsule(capsule);
  expect(restored.cookies).toHaveLength(1);
  expect(restored.origins.map(x=>x.origin)).toEqual(["https://chatgpt.com"]);
  expect(summary).toMatchObject({eligibleCookies:1,originCount:1});
  expect(JSON.stringify(summary)).not.toMatch(/DO_NOT_LOG/);
 });
 it("rejects expired-only, absent-chatgpt and over-limit snapshots without a Secret update",()=>{
  expect(()=>prepareRenewedCapsule({...sample,cookies:[{...goodCookie,expires:100}]},1780000000000)).toThrow();
  expect(()=>prepareRenewedCapsule({...sample,origins:[]},1780000000000)).toThrow();
  const huge={...sample,origins:[{origin:"https://chatgpt.com",localStorage:[
   {name:"blob",value:Array.from({length:12500},(_,i)=>String(i%10)).join("")}]}]};
  expect(()=>prepareRenewedCapsule(huge,1780000000000,10)).toThrow();
 });
 it("never accepts a third-party cookie as part of renewal",()=>{
  const {capsule}=prepareRenewedCapsule({...sample,cookies:[goodCookie,{...goodCookie,domain:"evilchatgpt.com"}]},1780000000000);
  expect(decodeBrowserSessionCapsule(capsule).cookies).toHaveLength(1);
 });
});
