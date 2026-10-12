import { gunzipSync } from "node:zlib";

export type BrowserSessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

export type BrowserSessionOrigin = {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
};

export type BrowserSessionState = {
  cookies: BrowserSessionCookie[];
  origins: BrowserSessionOrigin[];
};

const allowedOrigins = new Set([
  "https://chatgpt.com",
  "https://auth.openai.com",
  "https://openai.com",
]);

function allowedCookieDomain(domain: string): boolean {
  return /(^|\.)chatgpt\.com$/i.test(domain) || /(^|\.)openai\.com$/i.test(domain);
}

function assertString(value: unknown, label: string, max = 262_144): asserts value is string {
  if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${label}`);
}

export function validateBrowserSessionState(input: unknown): BrowserSessionState {
  if (!input || typeof input !== "object") throw new Error("Invalid browser session state");
  const state = input as Partial<BrowserSessionState>;
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error("Invalid browser session state");
  }

  for (const cookie of state.cookies) {
    if (!cookie || typeof cookie !== "object") throw new Error("Invalid browser session cookie");
    assertString(cookie.name, "cookie name", 4096);
    assertString(cookie.value, "cookie value");
    assertString(cookie.domain, "cookie domain", 512);
    assertString(cookie.path, "cookie path", 4096);
    if (!allowedCookieDomain(cookie.domain)) throw new Error("Browser session cookie domain is not allowed");
    if (typeof cookie.expires !== "number" || !Number.isFinite(cookie.expires)) throw new Error("Invalid cookie expiry");
    if (typeof cookie.httpOnly !== "boolean" || typeof cookie.secure !== "boolean") throw new Error("Invalid cookie flags");
    if (!["Strict", "Lax", "None"].includes(cookie.sameSite)) throw new Error("Invalid cookie sameSite");
  }

  for (const origin of state.origins) {
    if (!origin || typeof origin !== "object") throw new Error("Invalid browser session origin");
    assertString(origin.origin, "origin", 2048);
    if (!allowedOrigins.has(origin.origin)) throw new Error("Browser session origin is not allowed");
    if (!Array.isArray(origin.localStorage)) throw new Error("Invalid browser session localStorage");
    for (const entry of origin.localStorage) {
      if (!entry || typeof entry !== "object") throw new Error("Invalid localStorage entry");
      assertString(entry.name, "localStorage name", 65_536);
      assertString(entry.value, "localStorage value");
    }
  }

  return state as BrowserSessionState;
}

export function decodeBrowserSessionCapsule(capsule: string): BrowserSessionState {
  try {
    if (typeof capsule !== "string" || capsule.length < 16 || capsule.length > 65_536) {
      throw new Error("invalid length");
    }
    const compressed = Buffer.from(capsule, "base64");
    const json = gunzipSync(compressed, { maxOutputLength: 1_048_576 }).toString("utf8");
    return validateBrowserSessionState(JSON.parse(json));
  } catch {
    throw new Error("Invalid browser session capsule");
  }
}
