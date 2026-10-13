import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

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

/** Bearer-equivalent capsule transport for the approved main-only Actions job.
 * Parts carry a shared SHA-256 and index; incomplete/mixed updates fail closed.
 * Do not log returned strings or place them in files/artifacts.
 */
export function splitBrowserSessionCapsule(
  capsule:string,maxPartLength=48_000,
):readonly [string,string]{
  try{
    decodeBrowserSessionCapsule(capsule);
    const sha=createHash("sha256").update(capsule,"ascii").digest("hex");
    const middle=Math.ceil(capsule.length/2);
    const first="qc1:"+sha+":1/2:"+capsule.slice(0,middle);
    const second="qc1:"+sha+":2/2:"+capsule.slice(middle);
    if(first.length>=maxPartLength || second.length>=maxPartLength)throw Error("size");
    return [first,second] as const;
  }catch{throw new Error("Invalid session secret transport");}
}

export function resolveBrowserSessionCapsule(input:{
 legacy?:string|undefined;part1?:string|undefined;part2?:string|undefined;
}):string{
  try{
    if(input.part1!==undefined || input.part2!==undefined){
      if(!input.part1 || !input.part2)throw Error("incomplete");
      const p1=/^qc1:([a-f0-9]{64}):1\/2:([A-Za-z0-9+/=]+)$/.exec(input.part1);
      const p2=/^qc1:([a-f0-9]{64}):2\/2:([A-Za-z0-9+/=]+)$/.exec(input.part2);
      if(!p1 || !p2 || p1[1]!==p2[1] || input.part1.length>=48_000 || input.part2.length>=48_000)
        throw Error("part_mismatch");
      const capsule=p1[2]!+p2[2]!;
      if(createHash("sha256").update(capsule,"ascii").digest("hex")!==p1[1])throw Error("digest");
      decodeBrowserSessionCapsule(capsule);
      return capsule;
    }
    if(!input.legacy || input.legacy.length>=48_000)throw Error("no_legacy");
    decodeBrowserSessionCapsule(input.legacy);
    return input.legacy;
  }catch{throw new Error("Invalid session secret transport");}
}