import {describe,expect,it} from "vitest";
import {gzipSync} from "node:zlib";
import {randomBytes} from "node:crypto";
import {resolveBrowserSessionCapsule,splitBrowserSessionCapsule,decodeBrowserSessionCapsule} from "./session-capsule.js";
const fixture=(n:number)=>gzipSync(Buffer.from(JSON.stringify({
 cookies:[{name:"synthetic",value:"x".repeat(n),domain:".chatgpt.com",path:"/",expires:-1,httpOnly:true,secure:true,sameSite:"Lax"}],
 origins:[{origin:"https://chatgpt.com",localStorage:[{name:"synthetic",value:"synthetic"}]}],
}))).toString("base64");
const valid=fixture(32);
const randomLike=()=>{
 const b=Buffer.alloc(39000);for(let i=0;i<b.length;i++)b[i]=(i*173+Math.floor(i/251)*59)&255;
 // deterministic synthetic plaintext with hard-to-compress bytes
 return gzipSync(b).toString("base64");
};
describe("two-part session secret transport",()=>{
 it("splits a valid capsule into two bounded parts and reconstructs without changing bytes",()=>{
  const [a,b]=splitBrowserSessionCapsule(valid);
  expect(a.length).toBeLessThan(48000);
  expect(b.length).toBeLessThan(48000);
  expect(resolveBrowserSessionCapsule({part1:a,part2:b})).toBe(valid);
  expect(decodeBrowserSessionCapsule(resolveBrowserSessionCapsule({part1:a,part2:b})).cookies).toHaveLength(1);
 });
 it("transports a synthetic >48KB but <=64KB capsule within two GitHub Secret limits",()=>{
  const large=gzipSync(Buffer.from(JSON.stringify({
   cookies:[{name:"synthetic",value:randomBytes(45000).toString("base64"),domain:".chatgpt.com",path:"/",expires:-1,httpOnly:true,secure:true,sameSite:"Lax"}],
   origins:[{origin:"https://chatgpt.com",localStorage:[{name:"synthetic",value:"synthetic"}]}],
  }))).toString("base64");
  expect(large.length).toBeGreaterThan(48000);
  expect(large.length).toBeLessThan(65536);
  const [first,second]=splitBrowserSessionCapsule(large);
  expect(first.length).toBeLessThan(48000);
  expect(second.length).toBeLessThan(48000);
  expect(resolveBrowserSessionCapsule({part1:first,part2:second})).toBe(large);
 });
 it("preserves the legacy one-secret path without partial updates",()=>{
  expect(resolveBrowserSessionCapsule({legacy:valid})).toBe(valid);
  expect(resolveBrowserSessionCapsule({legacy:valid,part1:"",part2:""})).toBe(valid);
  expect(()=>resolveBrowserSessionCapsule({legacy:valid,part1:"partial"})).toThrow(/Invalid session secret transport/);
  expect(()=>resolveBrowserSessionCapsule({legacy:valid,part2:"partial"})).toThrow(/Invalid session secret transport/);
  expect(()=>resolveBrowserSessionCapsule({})).toThrow(/Invalid session secret transport/);
 });
 it("detects mixed sessions, swapped indices and tampering before decoding",()=>{
  const [a,b]=splitBrowserSessionCapsule(valid);
  const other=fixture(33),[c,d]=splitBrowserSessionCapsule(other);
  expect(()=>resolveBrowserSessionCapsule({part1:a,part2:d})).toThrow(/Invalid session secret transport/);
  expect(()=>resolveBrowserSessionCapsule({part1:b,part2:a})).toThrow(/Invalid session secret transport/);
  expect(()=>resolveBrowserSessionCapsule({part1:a,part2:b.slice(0,-1)+"z"})).toThrow(/Invalid session secret transport/);
  expect(()=>resolveBrowserSessionCapsule({part1:c,part2:b})).toThrow(/Invalid session secret transport/);
 });
 it("rejects oversized, empty or invalid untrusted payloads",()=>{
  expect(()=>splitBrowserSessionCapsule("broken")).toThrow(/Invalid session secret transport/);
  expect(()=>splitBrowserSessionCapsule("x".repeat(66000))).toThrow(/Invalid session secret transport/);
  expect(()=>splitBrowserSessionCapsule(valid,10)).toThrow(/Invalid session secret transport/);
  expect(()=>resolveBrowserSessionCapsule({legacy:"x".repeat(48000)})).toThrow(/Invalid session secret transport/);
 });
});
