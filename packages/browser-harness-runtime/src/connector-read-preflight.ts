import type {Page} from "playwright-core";
import {assessConnectorReadProof} from "./connector-read-proof.js";
import {normalizeAppMenuCounts,selectAppCandidateRole,type AppMenuSignals} from "./connector-app-menu.js";
import type {Locator} from "playwright-core";
import {assessConnectorPreflight,type ConnectorPreflightSignals} from "./connector-read-preflight-policy.js";

/** Deliberately one normal ChatGPT UI send. No API impersonation, connector credentials,
 * request interception, navigation to undocumented endpoints, retry or write action.
 * The reply and UI are inspected in memory; only sanitized booleans cross into logs.
 */
const PROMPT="Using the connected GitHub App only, READ the current default-branch HEAD commit SHA of public tibame201020/Queqiao. Do not use web search. Do not modify, create, publish, delete or approve anything. If the GitHub App is unavailable, say UNAVAILABLE. Reply with ONLY the exact 40 lowercase hexadecimal characters of that HEAD SHA.";
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function visibleAny(loc:Locator):Promise<number>{
 const n=Math.min(await loc.count(),8);
 for(let i=0;i<n;i++)if(await loc.nth(i).isVisible().catch(()=>false))return 1;
 return 0;
}
async function observeAppMenu(page:Page):Promise<{signals:AppMenuSignals;option:Locator;menuitem:Locator}>{
 const menu=page.getByRole("menu"),listbox=page.getByRole("listbox"),dialog=page.getByRole("dialog");
 const [m,l,d]=await Promise.all([visibleAny(menu),visibleAny(listbox),visibleAny(dialog)]);
 const scope=l?listbox.first():m?menu.first():d?dialog.first():page.locator("body");
 const option=scope.getByRole("option",{name:/^GitHub(?:\b|$)/i});
 const menuitem=scope.getByRole("menuitem",{name:/^GitHub(?:\b|$)/i});
 const counts={
  menu:m,listbox:l,dialog:d,option:await visibleAny(option),menuitem:await visibleAny(menuitem),
  button:await visibleAny(scope.getByRole("button",{name:/^GitHub(?:\b|$)/i})),
  text:await visibleAny(page.getByText("GitHub",{exact:true})),
 };
 return {signals:normalizeAppMenuCounts(counts),option,menuitem};
}
type Stage="preflight"|"app_selection"|"submission"|"conversation"|"tool_observation"|"response"|"validation";
export async function runConnectorReadPreflight(page:Page,authenticated:boolean):Promise<void>{
 let stage:Stage="preflight",submitted=false,appSelected=false,toolObserved=false;
 let verdict="not_observed";
 let menuSignals:AppMenuSignals|undefined;
 let preflightSignals:ConnectorPreflightSignals|undefined;
 const runId=process.env["GITHUB_RUN_ID"]??"";
 const expectedSha=process.env["CONNECTOR_EXPECTED_SHA"]??"";
 try{
  const editor=page.locator('[contenteditable="true"][role="textbox"]').first();
  let blankStart=false;
  try{blankStart=new URL(page.url()).pathname==="/";}catch{/* fail closed */}
  preflightSignals={
   authenticated,runIdValid:/^\\d{1,20}$/.test(runId),expectedShaValid:/^[a-f0-9]{40}$/.test(expectedSha),
   blankStart,editorVisible:await editor.isVisible().catch(()=>false),
   editorEnabled:await editor.isEnabled().catch(()=>false),
  };
  if(assessConnectorPreflight(preflightSignals)!=="ready")throw Error("preflight");
  stage="app_selection";
  // Normal user-facing @ selector. Do not send a text-only @GitHub instruction
  // if the actual app cannot be selected from an observed UI option.
  await editor.fill("@GitHub");
  await sleep(1000); // Only one normal UI observation; do not retry or route around rejection.
  const observation=await observeAppMenu(page);
  menuSignals=observation.signals;
  const role=selectAppCandidateRole(menuSignals);
  if(role==="none")throw Error("native_app_option_not_observed");
  await (role==="option"?observation.option:observation.menuitem).first().click();
  appSelected=true;
  stage="submission";
  await editor.press("End");
  await editor.press("Space");
  await page.keyboard.insertText(PROMPT);
  await editor.press("Enter"); // exactly one send, never retry on uncertain send
  submitted=true;
  stage="conversation";
  await page.waitForURL(/^https:\/\/chatgpt\.com\/c\/[a-z0-9-]+(?:[?#].*)?$/i,{timeout:30000});
  stage="tool_observation";
  // A tool card must be visible in the normal UI, not a claim in generated prose
  // or a mention chip in the user turn.
  const toolCard=page.locator('main [data-testid*="tool"],main [data-testid*="connector"]')
    .filter({hasText:/GitHub/i}).first();
  await toolCard.waitFor({state:"visible",timeout:90000});
  toolObserved=true;
  stage="response";
  const answer=page.locator("main").getByText(/^[a-f0-9]{40}$|^UNAVAILABLE$/).last();
  await answer.waitFor({state:"visible",timeout:90000});
  const inUser=await answer.evaluate(el=>Boolean(el.closest(
   '[data-message-author-role="user"],[class*="user-message"]'
  ))).catch(()=>true);
  if(inUser)throw Error("not_assistant");
  const stop=page.getByRole("button",{name:/^(Stop|停止|停止生成)$/i});
  let prior="",stable=0;
  for(let i=0;i<40;i++){
   await sleep(1500);
   const now=(await answer.innerText().catch(()=>"")).trim();
   const busy=await stop.first().isVisible().catch(()=>false);
   if(now && !busy && now===prior)stable++;else stable=0;
   prior=now;
   if(stable>=2)break;
  }
  if(stable<2||!await editor.isEnabled())throw Error("incomplete");
  stage="validation";
  verdict=assessConnectorReadProof({appSelected,toolObserved,reply:prior,expectedSha});
  if(verdict!=="verified")throw Error("not_verified");
  console.log(JSON.stringify({schema:"queqiao.gate3.connector-read-preflight.v1",
    runId,stage:"validated",appSelected:true,toolObserved:true,shaMatched:true,
    status:"verified",writeAttempted:false}));
 }catch{
  // Neither raw answer nor error/URL/DOM/session/app list is logged.
  console.log(JSON.stringify({schema:"queqiao.gate3.connector-read-preflight.v1",
   runId:/^\d{1,20}$/.test(runId)?runId:"invalid",stage,status:"failed",
   appSelected,toolObserved,submitted,verdict,...(menuSignals?{menuSignals}:{}),...(preflightSignals?{preflightSignals}:{}),writeAttempted:false}));
  throw Error("G3_CONNECTOR_READ_FAILED_AT_"+stage.toUpperCase());
 }
}
