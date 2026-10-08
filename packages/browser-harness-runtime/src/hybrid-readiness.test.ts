import { describe, expect, it } from "vitest";
import { classifyHybridReadiness } from "./hybrid-readiness.js";

describe("hybrid Browser Harness runtime preflight", () => {
  it("allows hybrid execution only with authenticated browser and active runtime provider", () => {
    expect(classifyHybridReadiness({ browser: "authenticated", managementStatus: 200 })).toEqual({
      ready: true, reason: "ready"
    });
  });

  it("reports a Gateway without Runtime Provider support", () => {
    expect(classifyHybridReadiness({ browser: "authenticated", managementStatus: 404 })).toEqual({
      ready: false, reason: "provider_missing"
    });
  });

  it("distinguishes management authorization from missing provider", () => {
    expect(classifyHybridReadiness({ browser: "authenticated", managementStatus: 401 })).toEqual({
      ready: false, reason: "management_unauthorized"
    });
  });

  it("does not treat network failure as absent configuration", () => {
    expect(classifyHybridReadiness({ browser: "authenticated", managementStatus: null })).toEqual({
      ready: false, reason: "management_unreachable"
    });
  });

  it("will never pass a challenge or logged out browser", () => {
    expect(classifyHybridReadiness({ browser: "browser_challenge", managementStatus: 200 })).toEqual({
      ready: false, reason: "browser_challenge"
    });
    expect(classifyHybridReadiness({ browser: "logged_out", managementStatus: 200 })).toEqual({
      ready: false, reason: "browser_logged_out"
    });
  });
});
