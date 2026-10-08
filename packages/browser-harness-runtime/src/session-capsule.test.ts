import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeBrowserSessionCapsule,
  validateBrowserSessionState,
  type BrowserSessionState,
} from "./session-capsule.js";

function capsule(state: BrowserSessionState): string {
  return gzipSync(Buffer.from(JSON.stringify(state))).toString("base64");
}

describe("browser session capsule", () => {
  it("decodes a gzip+base64 ChatGPT session capsule", () => {
    const state: BrowserSessionState = {
      cookies: [
        {
          name: "session",
          value: "redacted-test-value",
          domain: ".chatgpt.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
      origins: [
        {
          origin: "https://chatgpt.com",
          localStorage: [{ name: "ui", value: "test" }],
        },
      ],
    };

    expect(decodeBrowserSessionCapsule(capsule(state))).toEqual(state);
  });

  it("rejects cookies outside ChatGPT/OpenAI domains", () => {
    const state: BrowserSessionState = {
      cookies: [
        {
          name: "session",
          value: "redacted-test-value",
          domain: ".example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
      origins: [],
    };

    expect(() => validateBrowserSessionState(state)).toThrow(/cookie domain/i);
  });

  it("rejects origins outside the explicit ChatGPT/OpenAI allowlist", () => {
    const state: BrowserSessionState = {
      cookies: [],
      origins: [{ origin: "https://example.com", localStorage: [] }],
    };

    expect(() => validateBrowserSessionState(state)).toThrow(/origin/i);
  });

  it("rejects malformed capsules without exposing their content", () => {
    expect(() => decodeBrowserSessionCapsule("not-a-capsule")).toThrow("CAPSULE_FORMAT");
  });
  it("distinguishes corrupt compression without exposing content", () => {
    expect(() => decodeBrowserSessionCapsule(Buffer.from("not-gzip").toString("base64")))
      .toThrow("CAPSULE_COMPRESSION");
  });

  it("distinguishes invalid JSON without exposing content", () => {
    expect(() => decodeBrowserSessionCapsule(gzipSync(Buffer.from("not-json")).toString("base64")))
      .toThrow("CAPSULE_JSON");
  });

  it("distinguishes invalid state schema without exposing content", () => {
    expect(() => decodeBrowserSessionCapsule(capsule({ cookies: [], origins: [{ origin: "https://example.com", localStorage: [] }] })))
      .toThrow("CAPSULE_SCHEMA");
  });

  it("accepts whitespace-surrounded base64 capsule", () => {
    const state: BrowserSessionState = { cookies: [], origins: [] };
    expect(decodeBrowserSessionCapsule("\\n" + capsule(state) + "\\r\\n")).toEqual(state);
  });
});
