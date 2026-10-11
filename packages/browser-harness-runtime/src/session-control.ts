import type { Browser } from "playwright-core";
import { classifySessionPage, type SessionPageVerdict } from "./session-verdict.js";

export type ControlResult={
  verdict:SessionPageVerdict|"navigation_error";
  isolated:boolean;
};
export type SessionComparison="both_contexts_challenged"|"restored_only_challenged"|"authenticated_composer"|"inconclusive"|"not_authenticated";

export function assessSessionComparison(control:ControlResult,restored:SessionPageVerdict):SessionComparison{
  if(!control.isolated || control.verdict==="authenticated") throw new Error("Unauthenticated control isolation not proven");
  if(restored==="authenticated")return "authenticated_composer";
  if(control.verdict==="browser_challenge" && restored==="browser_challenge")return "both_contexts_challenged";
  if((control.verdict==="logged_out" || control.verdict==="guest_composer") && restored==="browser_challenge")return "restored_only_challenged";
  if(control.verdict==="navigation_error" || control.verdict==="pending")return "inconclusive";
  return "not_authenticated";
}

/** No capsule or browser profile enters this fresh incognito context.
 * Inspect page status only. Do not take screenshots or persist browser state.
 * Never interact with a challenge or sign in.
 */
export async function probeUnauthenticatedControl(browser:Browser):Promise<ControlResult>{
  const context=await browser.newContext({storageState:{cookies:[],origins:[]}});
  try{
    const initial=await context.storageState();
    const isolated=initial.cookies.length===0 && initial.origins.length===0;
    if(!isolated)throw new Error("Unauthenticated control isolation not proven");
    const page=await context.newPage();
    let verdict:ControlResult["verdict"]="pending";
    try{
      await page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded",timeout:30_000});
      const deadline=Date.now()+18_000;
      while(Date.now()<deadline){
        verdict=classifySessionPage({
          url:page.url(),
          title:await page.title().catch(()=>""),
          loginLinks:await page.getByRole("link",{name:/log in|登入/i}).count().catch(()=>0),
          signupLinks:await page.getByRole("link",{name:/sign up|註冊/i}).count().catch(()=>0),
          composerCount:await page.locator('textarea,[contenteditable="true"]').count().catch(()=>0),
        });
        if(verdict==="logged_out" || verdict==="guest_composer" || verdict==="authenticated")break;
        await page.waitForTimeout(1_500);
      }
    }catch{
      verdict="navigation_error";
    }
    if(verdict==="authenticated")throw new Error("Unauthenticated control isolation not proven");
    return {verdict,isolated};
  }finally{
    await context.close();
  }
}
