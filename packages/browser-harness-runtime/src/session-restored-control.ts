import type {Browser,BrowserContext} from "playwright-core";
import type {BrowserSessionState} from "./session-capsule.js";
import {summarizeCookieRestore,summarizeStorageRestore,type CookieRestoreSummary,type StorageRestoreSummary} from "./session-restore-diagnostics.js";
import {createHttpDiagnostics,failedNavigation,summarizeNavigation,type NavigationSummary,type HttpSummary} from "./session-http-diagnostics.js";
import {classifySessionPage,type SessionPageSignals,type SessionPageVerdict} from "./session-verdict.js";
import {readSessionEvidence} from "./session-auth-evidence.js";

export type RestoredContextProbe={
 verdict:SessionPageVerdict|"navigation_error";
 navigation:NavigationSummary;
 cookies:CookieRestoreSummary;
 localStorage:StorageRestoreSummary;
 http:HttpSummary;
};
export type RestoredContextComparison=
 "both_restored_contexts_challenged"|"default_context_only_challenged"|
 "isolated_context_authenticated"|"inconclusive"|"other";

export function compareRestoredContexts(
 defaultVerdict:SessionPageVerdict,defaultStatus:number|null,
 probe:RestoredContextProbe,
):RestoredContextComparison{
 if(probe.verdict==="navigation_error" || probe.navigation.status===null)return "inconclusive";
 if(probe.verdict==="authenticated")return "isolated_context_authenticated";
 if(defaultVerdict==="browser_challenge" && defaultStatus===403 &&
    probe.verdict==="browser_challenge" && probe.navigation.status===403)
   return "both_restored_contexts_challenged";
 if(defaultVerdict==="browser_challenge" && probe.verdict!=="browser_challenge")
   return "default_context_only_challenged";
 return "other";
}

/** One additional read-only navigation in an isolated Context on the same
 * trusted CI Runner. Never clicks challenges, saves profile, or retries.
 * Return only aggregate fields; all session material stays inside Chrome.
 */
export async function probeRestoredContext(
 browser:Browser,state:BrowserSessionState,
 installStorage:(context:BrowserContext)=>Promise<void>,
):Promise<RestoredContextProbe>{
 const context=await browser.newContext({storageState:{cookies:[],origins:[]}});
 try{
  const initial=await context.storageState();
  if(initial.cookies.length || initial.origins.length)throw new Error("Restored control isolation invalid");
  await context.addCookies(state.cookies);
  await installStorage(context);
  const page=await context.newPage();
  const http=createHttpDiagnostics();
  page.on("response",response=>http.observe(response.url(),response.status()));
  let navigation:NavigationSummary=failedNavigation();
  let verdict:RestoredContextProbe["verdict"]="pending";
  try{
   const response=await page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded",timeout:30000});
   navigation=summarizeNavigation(response);
   const deadline=Date.now()+12000;
   let checked=false;
   let confirmed=false;
   while(Date.now()<deadline){
    const signals:SessionPageSignals={
      url:page.url(),title:await page.title().catch(()=>""),
      loginLinks:await page.getByRole("link",{name:/log in|登入/i}).count().catch(()=>0),
      signupLinks:await page.getByRole("link",{name:/sign up|註冊/i}).count().catch(()=>0),
      composerCount:await page.locator('textarea,[contenteditable="true"]').count().catch(()=>0),
    };
    if(!checked && classifySessionPage(signals)==="guest_composer"){
      checked=true;
      confirmed=(await readSessionEvidence(page)).sessionConfirmed;
    }
    signals.sessionConfirmed=confirmed;
    verdict=classifySessionPage(signals);
    if(verdict==="authenticated" || verdict==="guest_composer" ||
       verdict==="browser_challenge" || verdict==="logged_out")break;
    await page.waitForTimeout(1500);
   }
  }catch{
    // Never print raw errors or potentially sensitive URL information.
    verdict="navigation_error";
    navigation=failedNavigation();
  }
  const cookies=summarizeCookieRestore(state.cookies,await context.cookies(),Date.now());
  const observed=await context.storageState().then(s=>s.origins,()=>[]);
  const localStorage=summarizeStorageRestore(state.origins,observed);
  // An absent observable origin is NOT treated as successful restoration.

  return {verdict,navigation,cookies,localStorage,http:http.snapshot()};
 }finally{
  await context.close();
 }
}
