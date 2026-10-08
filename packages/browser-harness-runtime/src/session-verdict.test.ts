import { describe, expect, it } from "vitest";
import { classifySessionPage, type SessionPageSignals } from "./session-verdict.js";

const sample: SessionPageSignals = {
  url: "https://chatgpt.com/",
  title: "ChatGPT",
  loginLinks: 0,
  signupLinks: 0,
  composerCount: 1,
};

describe("ChatGPT Browser Harness acceptance verdict", () => {
  it("recognizes a ready authenticated composer", () => {
    expect(classifySessionPage(sample)).toBe("authenticated");
  });

  it("classifies the GitHub-hosted browser challenge separately from an invalid session", () => {
    expect(classifySessionPage({ ...sample, composerCount: 0, title: "Just a moment..." })).toBe("browser_challenge");
    expect(classifySessionPage({ ...sample, composerCount: 0, title: "請稍候..." })).toBe("browser_challenge");
  });

  it("does not accidentally pass while a browser challenge is shown", () => {
    expect(classifySessionPage({ ...sample, title: "Just a moment..." })).toBe("browser_challenge");
  });

  it("identifies explicit sign-in prompts or authentication redirects", () => {
    expect(classifySessionPage({ ...sample, composerCount: 0, loginLinks: 1 })).toBe("logged_out");
    expect(classifySessionPage({ ...sample, url: "https://chatgpt.com/auth/login", composerCount: 0 })).toBe("logged_out");
  });

  it("classifies slow app loading as pending instead of failed authentication", () => {
    expect(classifySessionPage({ ...sample, composerCount: 0 })).toBe("pending");
  });
});
