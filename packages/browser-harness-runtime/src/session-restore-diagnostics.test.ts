import { describe, expect, it } from "vitest";
import { summarizeCookieRestore, summarizeStorageRestore } from "./session-restore-diagnostics.js";
import type { BrowserSessionCookie, BrowserSessionOrigin } from "./session-capsule.js";

const cookie=(overrides:Partial<BrowserSessionCookie>={}):BrowserSessionCookie=>({
  name:"session-secret-name",value:"DO_NOT_PRINT_BROWSER_TOKEN",
  domain:".chatgpt.com",path:"/",expires:-1,httpOnly:true,secure:true,sameSite:"Lax",
  ...overrides,
});
const sourceOrigin:BrowserSessionOrigin={
  origin:"https://chatgpt.com",
  localStorage:[{name:"account-key",value:"DO_NOT_PRINT_LOCAL_STORAGE"}],
};

describe("session restore diagnostics never emit credential material",()=>{
  it("proves in-memory equality after Chrome restores an unexpired cookie",()=>{
    const before=[cookie(),cookie({name:"expired",value:"expired-secret",expires:110})];
    const result=summarizeCookieRestore(before,[cookie()],120_000);
    expect(result).toEqual({source:2,eligible:1,expired:1,matched:1,missing:0,changed:0});
    expect(JSON.stringify(result)).not.toMatch(/DO_NOT_PRINT|session-secret|account-key|expired-secret/);
  });
  it("distinguishes dropped cookie and different-value cookie without printing their identity",()=>{
    const changed=cookie({value:"DO_NOT_PRINT_DIFFERENT_VALUE"});
    expect(summarizeCookieRestore([cookie()],[changed],120_000))
      .toEqual({source:1,eligible:1,expired:0,matched:0,missing:0,changed:1});
    expect(summarizeCookieRestore([cookie()],[],120_000))
      .toEqual({source:1,eligible:1,expired:0,matched:0,missing:1,changed:0});
  });
  it("normalizes leading cookie domain dot without treating a different domain as equal",()=>{
    expect(summarizeCookieRestore([cookie()],[cookie({domain:"chatgpt.com"})],120_000).matched).toBe(1);
    expect(summarizeCookieRestore([cookie()],[cookie({domain:"evilchatgpt.com"})],120_000).missing).toBe(1);
  });
  it("does not confuse session cookie expires=-1 or expires=0 with expiry",()=>{
    expect(summarizeCookieRestore([cookie({expires:-1}),cookie({name:"other",expires:0})],
      [cookie(),cookie({name:"other",expires:0})],120_000).eligible).toBe(2);
  });
  it("reports localStorage source, observed and matched counts without keys or values",()=>{
    const result=summarizeStorageRestore([sourceOrigin],[sourceOrigin]);
    expect(result).toEqual({expected:1,observed:1,matched:1,status:"observed"});
    expect(JSON.stringify(result)).not.toMatch(/DO_NOT_PRINT|account-key/);
  });
  it("does not report successful storage restore if the origin is unavailable",()=>{
    expect(summarizeStorageRestore([sourceOrigin],[]))
      .toEqual({expected:1,observed:0,matched:0,status:"not_observed"});
    expect(summarizeStorageRestore([sourceOrigin],[{origin:"https://chatgpt.com",localStorage:[]}]))
      .toEqual({expected:1,observed:0,matched:0,status:"observed"});
  });
  it("does not match different storage values or different origins",()=>{
    expect(summarizeStorageRestore([sourceOrigin],[{
      origin:"https://chatgpt.com",localStorage:[{name:"account-key",value:"wrong-secret"}],
    }]).matched).toBe(0);
    expect(summarizeStorageRestore([sourceOrigin],[{
      origin:"https://example.com",localStorage:sourceOrigin.localStorage,
    }]).matched).toBe(0);
  });
});
