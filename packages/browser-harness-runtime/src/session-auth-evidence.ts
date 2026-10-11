import type { Page } from "playwright-core";

export type SessionEvidence={
  sessionConfirmed:boolean;
  check:"confirmed"|"not_confirmed"|"unavailable"|"not_checked";
};

/** Return ONLY a boolean/status aggregate. Never return the session JSON,
 * user ID, identity fields or bearer tokens to Node/CI logs.
 */
export function summarizeSessionEvidence(status:number,contentType:string,payload:unknown):SessionEvidence{
  if(status!==200 || !contentType.toLowerCase().includes("application/json"))
    return {sessionConfirmed:false,check:"unavailable"};
  const user=(payload && typeof payload==="object" && "user" in payload)
    ? (payload as {user?:unknown}).user : undefined;
  const id=(user && typeof user==="object" && "id" in user)
    ? (user as {id?:unknown}).id : undefined;
  const confirmed=typeof id==="string" && id.length>0;
  return {sessionConfirmed:confirmed,check:confirmed?"confirmed":"not_confirmed"};
}

/** Read-only same-origin web session check. This is an INTERNAL website
 * route, used as diagnostic evidence only. It is not a production API.
 * The browser evaluates and discards response data locally; only a
 * non-identifying verdict crosses the browser automation boundary.
 * No login, browser challenge interaction, or access-token extraction.
 */
export async function readSessionEvidence(page:Page):Promise<SessionEvidence>{
  try{
    return await page.evaluate(async()=>{
      try{
        const response=await fetch("/api/auth/session",{credentials:"same-origin",cache:"no-store"});
        const contentType=response.headers.get("content-type")??"";
        if(response.status!==200 || !contentType.toLowerCase().includes("application/json"))
          return {sessionConfirmed:false,check:"unavailable"} as const;
        const payload:unknown=await response.json();
        const user=(payload && typeof payload==="object" && "user" in payload)
          ? (payload as {user?:unknown}).user:undefined;
        const id=(user && typeof user==="object" && "id" in user)
          ? (user as {id?:unknown}).id:undefined;
        const confirmed=typeof id==="string" && id.length>0;
        return {sessionConfirmed:confirmed,check:confirmed?"confirmed":"not_confirmed"} as const;
      }catch{
        return {sessionConfirmed:false,check:"unavailable"} as const;
      }
    });
  }catch{
    return {sessionConfirmed:false,check:"unavailable"};
  }
}
