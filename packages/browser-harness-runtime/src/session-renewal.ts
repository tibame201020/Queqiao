import {gzipSync} from "node:zlib";
import {
  decodeBrowserSessionCapsule,validateBrowserSessionState,
  type BrowserSessionCookie,type BrowserSessionOrigin,
} from "./session-capsule.js";
import type {SessionEvidence} from "./session-auth-evidence.js";

const domains=/^(?:\.?chatgpt\.com|\.?openai\.com|\.?auth\.openai\.com)$/i;
const origins=new Set(["https://chatgpt.com","https://auth.openai.com","https://openai.com"]);
export type BrowserSnapshot={cookies:BrowserSessionCookie[];origins:BrowserSessionOrigin[]};
export type RenewalSummary={eligibleCookies:number;expiredCookies:number;originCount:number;compressedBytes:number};

export function assertAttendedLogin(
  evidence:SessionEvidence,composer:boolean,challenge:boolean,
):void{
  if(evidence.check!=="confirmed" || evidence.sessionConfirmed!==true || !composer || challenge)
    throw new Error("Attended ChatGPT login has not been independently verified");
}
export function prepareRenewedCapsule(
  snapshot:BrowserSnapshot,nowMs:number,maxChars=48000,
):{capsule:string;summary:RenewalSummary}{
  const allowedCookies=snapshot.cookies.filter(c=>domains.test(c.domain));
  const allowedOrigins=snapshot.origins.filter(o=>origins.has(o.origin));
  const state=validateBrowserSessionState({cookies:allowedCookies,origins:allowedOrigins});
  const now=nowMs/1000;
  const eligible=state.cookies.filter(c=>c.expires<=0 || c.expires>now);
  const chatgpt=state.origins.find(o=>o.origin==="https://chatgpt.com");
  if(eligible.length===0 || !chatgpt)throw new Error("New session state is incomplete");
  const capsule=gzipSync(Buffer.from(JSON.stringify(state),"utf8")).toString("base64");
  if(capsule.length<16 || capsule.length>=maxChars)
    throw new Error("New session capsule exceeds the current approved CI size bound");
  // Decoder is the same path used by the Actions acceptance gate.
  decodeBrowserSessionCapsule(capsule);
  return {
    capsule,
    summary:{eligibleCookies:eligible.length,
      expiredCookies:state.cookies.length-eligible.length,
      originCount:state.origins.length,
      compressedBytes:Buffer.byteLength(capsule,"ascii")},
  };
}
