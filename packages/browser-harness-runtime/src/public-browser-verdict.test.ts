import { describe, expect, it } from "vitest";
import { validatePublicBrowserReceipt } from "./public-browser-verdict.js";

const valid = {
  runId:"42", origin:"https://example.com", pageTitle:"Example Domain",
  interactiveMarker:"QUEQIAO_CI_BROWSER_HARNESS_OK", clicks:1,
  inputEcho:"CI-only-synthetic-input", headless:true,
};

describe("CI-only public Browser Harness receipt",()=>{
  it("accepts a completed external navigation plus genuine browser DOM interaction",()=>{
    expect(validatePublicBrowserReceipt(valid)).toEqual(valid);
  });
  it.each([
    ["run id",{runId:"unknown"}],
    ["external origin",{origin:"https://chatgpt.com"}],
    ["page title",{pageTitle:"Log in"}],
    ["DOM marker",{interactiveMarker:"QUEQIAO_CI_BROWSER_HARNESS_FAIL"}],
    ["button click",{clicks:0}],
    ["input echo",{inputEcho:"wrong"}],
    ["headless",{headless:false}],
  ])("fails closed for invalid %s",(_label,change)=>{
    expect(()=>validatePublicBrowserReceipt({...valid,...change})).toThrow();
  });
  it("disallows unexpected receipt keys including browser session data",()=>{
    expect(()=>validatePublicBrowserReceipt({...valid,cookies:["session"]})).toThrow();
  });
});
