import type {Page} from "playwright-core";
import {assessConnectorReadProof} from "./connector-read-proof.js";
import {normalizeAppMenuCounts,selectAppCandidateRole,type AppMenuSignals} from "./connector-app-menu.js";
import type {Locator} from "playwright-core";
import {assessConnectorPreflight,type ConnectorPreflightSignals} from "./connector-read-preflight-policy.js";
import {observeConnectorComposer} from "./connector-read-composer.js";
import {classifyConnectorToolObservation,type ConnectorToolSignals} from "./connector-tool-diagnostics.js";
import {classifyConnectorPostsendState,type ConnectorPostsendSignals} from "./connector-postsend-diagnostics.js";
import {assessConnectorUserTurn,type ConnectorUserTurnSignals} from "./connector-user-turn.js";
import {classifyUserTurnStructure,type UserTurnStructureSignals} from "./connector-user-turn-structure.js";
import {assessConnectorDraft,type ConnectorDraftSignals} from "./connector-presend-draft.js";
import {classifyPostsendStructure,type PostsendStructureSignals} from "./connector-postsend-structure.js";

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
async function visibleCountAtMostTwo(loc:Locator):Promise<number>{
 const n=Math.min(await loc.count(),8);let visible=0;
 for(let i=0;i<n;i++)if(await loc.nth(i).isVisible().catch(()=>false)){visible++;if(visible>1)return 2;}
 return visible;
}
async function observeAppMenu(page:Page):Promise<{signals:AppMenuSignals;option:Locator;menuitem:Locator;button:Locator;buttonCount:number}>{
 const menu=page.getByRole("menu"),listbox=page.getByRole("listbox"),dialog=page.getByRole("dialog");
 const [m,l,d]=await Promise.all([visibleAny(menu),visibleAny(listbox),visibleAny(dialog)]);
 const scope=l?listbox.first():m?menu.first():d?dialog.first():page.locator("body");
 const option=scope.getByRole("option",{name:/^GitHub(?:\b|$)/i});
 const menuitem=scope.getByRole("menuitem",{name:/^GitHub(?:\b|$)/i});
 const button=scope.getByRole("button",{name:/^GitHub(?:\b|$)/i});
 const buttonCount=await visibleCountAtMostTwo(button);
 const counts={
  menu:m,listbox:l,dialog:d,option:await visibleAny(option),menuitem:await visibleAny(menuitem),
  button:buttonCount,text:await visibleAny(page.getByText("GitHub",{exact:true})),
 };
 return {signals:normalizeAppMenuCounts(counts),option,menuitem,button,buttonCount};
}

async function visibleAssistantCandidate(loc:Locator):Promise<boolean>{
 const n=Math.min(await loc.count(),8);
 for(let i=0;i<n;i++){
  const candidate=loc.nth(i);
  if(!await candidate.isVisible().catch(()=>false))continue;
  const assistantOwned=await candidate.evaluate(el=>Boolean(el.closest('[data-message-author-role="assistant"]'))
   && !el.closest('[data-message-author-role="user"]')).catch(()=>false);
  if(assistantOwned)return true;
 }
 return false;
}
async function observeToolDiagnostics(page:Page):Promise<ConnectorToolSignals>{
 const generic=page.locator('main [data-testid*="tool"],main [data-testid*="connector"]');
 return {
  genericToolCardVisible:await visibleAny(generic)>0,
  githubCardVisible:await visibleAny(generic.filter({hasText:/GitHub/i}))>0,
  assistantShaVisible:await visibleAssistantCandidate(page.locator("main").getByText(/^[a-f0-9]{40}$/)),
  assistantUnavailableVisible:await visibleAssistantCandidate(page.locator("main").getByText(/^UNAVAILABLE$/)),
 };
}

async function observePostsendSignals(page:Page,editor:Locator):Promise<ConnectorPostsendSignals>{
 const promptEcho=page.locator("main").getByText(PROMPT,{exact:false});
 const n=Math.min(await promptEcho.count(),8);
 let userTurnVisible=false;
 for(let i=0;i<n;i++){
  const item=promptEcho.nth(i);
  if(!await item.isVisible().catch(()=>false))continue;
  const outsideComposer=await item.evaluate(el=>!el.closest('[contenteditable="true"]')&&
    !el.closest('[data-message-author-role="assistant"]')).catch(()=>false);
  if(outsideComposer){userTurnVisible=true;break;}
 }
 const assistant=page.locator('main [data-message-author-role="assistant"],main .markdown');
 const stop=page.getByRole("button",{name:/^(Stop|停止|停止生成)$/i});
 return {
  userTurnVisible,
  assistantSurfaceVisible:await visibleAny(assistant)>0,
  stopVisible:await visibleAny(stop)>0,
  composerEnabled:await editor.isEnabled().catch(()=>false),
  dialogVisible:await visibleAny(page.getByRole("dialog"))>0,
 };
}

const PUBLIC_MIDDLE="current default-branch HEAD commit SHA of public tibame201020/Queqiao";
const PUBLIC_TAIL="Reply with ONLY the exact 40 lowercase hexadecimal characters of that HEAD SHA.";
const norm=(s:string)=>s.replace(/\s+/g," ").trim();
async function observeNativeUserTurn(page:Page,editor:Locator):Promise<UserTurnStructureSignals>{
 const users=page.locator('main [data-message-author-role="user"]');
 const n=Math.min(await users.count(),8);
 let userRoleVisible=false,middleInUserRole=false,tailInUserRole=false;
 for(let i=0;i<n;i++){
  const user=users.nth(i);
  if(!await user.isVisible().catch(()=>false))continue;
  userRoleVisible=true;
  const match=await user.evaluate((el,p)=>{
   const t=(el.textContent??"").replace(/\s+/g," ").trim();
   return {middle:t.includes(p.middle),tail:t.includes(p.tail)};
  },{middle:PUBLIC_MIDDLE,tail:PUBLIC_TAIL}).catch(()=>({middle:false,tail:false}));
  if(match.middle&&match.tail){middleInUserRole=true;tailInUserRole=true;break;}
 }
 // The generic fragments are diagnostics only; they never substitute for native
 // user-role ownership. Do not export, store or print any page content.
 async function outside(fragment:string):Promise<boolean>{
  const candidates=page.locator("main").getByText(fragment,{exact:false});
  const k=Math.min(await candidates.count(),8);
  for(let i=0;i<k;i++){
   const candidate=candidates.nth(i);
   if(!await candidate.isVisible().catch(()=>false))continue;
   const valid=await candidate.evaluate(el=>!el.closest('[contenteditable="true"]')&&
     !el.closest('[data-message-author-role="assistant"]')).catch(()=>false);
   if(valid)return true;
  }
  return false;
 }
 const assistant=page.locator('main [data-message-author-role="assistant"]');
 const assistantOwnedFragment=await (async()=>{
  const m=Math.min(await assistant.count(),8);
  for(let i=0;i<m;i++){
   const item=assistant.nth(i);
   if(!await item.isVisible().catch(()=>false))continue;
   if(await item.evaluate((el,p)=>{
    const t=(el.textContent??"").replace(/\s+/g," ").trim();
    return t.includes(p.middle)||t.includes(p.tail);
   },{middle:PUBLIC_MIDDLE,tail:PUBLIC_TAIL}).catch(()=>false))return true;
  }
  return false;
 })();
 const composerRetainsTail=await editor.innerText().then(t=>norm(t).includes(PUBLIC_TAIL)).catch(()=>true);
 return {
  conversationCreated:true,userRoleVisible,middleInUserRole,tailInUserRole,
  middleOutsideEditor:await outside(PUBLIC_MIDDLE),
  tailOutsideEditor:await outside(PUBLIC_TAIL),
  assistantOwnedFragment,composerRetainsTail,
 };
}

async function observeComposerDraft(editor:Locator):Promise<ConnectorDraftSignals>{
 const details=await editor.evaluate((el,p)=>{
  const doc=el.ownerDocument;
  const active=doc.activeElement;
  const text=(el.textContent??"").replace(/\s+/g," ").trim();
  return {
   editorFocused:active===el||Boolean(active&&el.contains(active)),
   middleInEditor:text.includes(p.middle),tailInEditor:text.includes(p.tail),
  };
 },{middle:PUBLIC_MIDDLE,tail:PUBLIC_TAIL}).catch(()=>({
  editorFocused:false,middleInEditor:false,tailInEditor:false,
 }));
 return {...details,editorEnabled:await editor.isEnabled().catch(()=>false)};
}

async function observePostsendStructure(page:Page):Promise<PostsendStructureSignals>{
 // Content is inspected in browser process memory and reduced to booleans;
 // never return raw DOM, text, URL, profile/session state, identities or App lists.
 const fragments={middle:PUBLIC_MIDDLE,tail:PUBLIC_TAIL};
 const main=page.locator("main");
 const mainVisible=await visibleAny(main)>0;
 const mainPublic=await main.first().evaluate((el,p)=>{
  const t=(el.textContent??"").replace(/\s+/g," ").trim();
  return {middle:t.includes(p.middle),tail:t.includes(p.tail)};
 },fragments).catch(()=>({middle:false,tail:false}));
 const bodyPublic=await page.locator("body").evaluate((el,p)=>{
  const t=(el.innerText??"").replace(/\s+/g," ").trim();
  return {middle:t.includes(p.middle),tail:t.includes(p.tail)};
 },fragments).catch(()=>({middle:false,tail:false}));
 return {
  mainVisible,
  visibleUserContainer:await visibleAny(page.locator('main [data-message-author-role="user"]'))>0,
  mainHasPublicMiddle:mainPublic.middle,mainHasPublicTail:mainPublic.tail,
  bodyHasPublicMiddle:bodyPublic.middle,bodyHasPublicTail:bodyPublic.tail,
  assistantSurfaceVisible:await visibleAny(page.locator('main [data-message-author-role="assistant"],main .markdown'))>0,
  dialogVisible:await visibleAny(page.getByRole("dialog"))>0,
  challengeVisible:await visibleAny(page.getByText(/verify you are human|checking your browser|請完成驗證/i))>0,
 };
}

type Stage="preflight"|"app_selection"|"draft_ready"|"submission"|"conversation"|"user_turn"|"tool_observation"|"response"|"validation";
export async function runConnectorReadPreflight(page:Page,authenticated:boolean):Promise<void>{
 let stage:Stage="preflight",submitted=false,appSelected=false,toolObserved=false;
 let verdict="not_observed";
 let menuSignals:AppMenuSignals|undefined;
 let preflightSignals:ConnectorPreflightSignals|undefined;
 let toolSignals:ConnectorToolSignals|undefined;
 let toolDiagnostic:string|undefined;
 let postsendSignals:ConnectorPostsendSignals|undefined;
 let postsendDiagnostic:string|undefined;
 let userTurnSignals:ConnectorUserTurnSignals|undefined;
 let userTurnStructure:UserTurnStructureSignals|undefined;
 let draftSignals:ConnectorDraftSignals|undefined;
 let postsendStructure:PostsendStructureSignals|undefined;
 let postsendStructureDiagnostic:string|undefined;
 const runId=process.env["GITHUB_RUN_ID"]??"";
 const expectedSha=process.env["CONNECTOR_EXPECTED_SHA"]??"";
 try{
  const editor=page.locator('[contenteditable="true"][role="textbox"]').first();
  let blankStart=false;
  try{blankStart=new URL(page.url()).pathname==="/";}catch{/* fail closed */}
  const composer=await observeConnectorComposer({
   waitForVisible:()=>editor.waitFor({state:"visible",timeout:15_000}),
   isVisible:()=>editor.isVisible(),
   isEnabled:()=>editor.isEnabled(),
  });
  preflightSignals={
   authenticated,runIdValid:/^\d{1,20}$/.test(runId),expectedShaValid:/^[a-f0-9]{40}$/.test(expectedSha),
   blankStart,...composer,
  };
  if(assessConnectorPreflight(preflightSignals)!=="ready")throw Error("preflight");
  stage="app_selection";
  // Normal user-facing @ selector. Do not send a text-only @GitHub instruction
  // if the actual app cannot be selected from an observed UI option.
  const baselineGithubButtonVisible=await visibleAny(page.getByRole("button",{name:/^GitHub(?:\b|$)/i}))>0;
  await editor.fill("@GitHub");
  await sleep(1000); // Only one normal UI observation; do not retry or route around rejection.
  const observation=await observeAppMenu(page);
  menuSignals=observation.signals;
  const role=selectAppCandidateRole(menuSignals,{baselineGithubButtonVisible,afterGithubButtonCount:observation.buttonCount});
  if(role==="none")throw Error("native_app_option_not_observed");
  await (role==="option"?observation.option:role==="menuitem"?observation.menuitem:observation.button).first().click();
  appSelected=true;
  stage="submission";
  await editor.press("End");
  await editor.press("Space");
  await page.keyboard.insertText(PROMPT);
  // A selected App control is not proof that subsequent keyboard input reached
  // the normal Composer. Check focus and two public fragments BEFORE any Enter.
  stage="draft_ready";
  draftSignals=await observeComposerDraft(editor);
  if(assessConnectorDraft(draftSignals)!=="ready")throw Error("draft_unconfirmed");
  stage="submission";
  await editor.press("Enter"); // exactly one send, never retry on uncertain send
  submitted=true;
  stage="conversation";
  await page.waitForURL(/^https:\/\/chatgpt\.com\/c\/[a-z0-9-]+(?:[?#].*)?$/i,{timeout:30000});
  // A key press is NOT proof of delivery. Mention chips may split the prefix:
  // match two independent public fragments in the same native user-owned turn.
  stage="user_turn";
  let verdictUserTurn:"user_turn_confirmed"|"unconfirmed"="unconfirmed";
  for(let i=0;i<20;i++){
   userTurnStructure=await observeNativeUserTurn(page,editor);
   verdictUserTurn=classifyUserTurnStructure(userTurnStructure);
   if(verdictUserTurn==="user_turn_confirmed")break;
   await sleep(1000);
  }
  userTurnSignals={
   conversationCreated:true,
   promptEchoOutsideEditor:Boolean(userTurnStructure?.middleInUserRole&&userTurnStructure?.tailInUserRole),
   promptStillInEditor:userTurnStructure?.composerRetainsTail??true,
  };
  if(verdictUserTurn!=="user_turn_confirmed"||
    assessConnectorUserTurn(userTurnSignals)!=="confirmed")throw Error("user_turn_unconfirmed");
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
  if(stage==="user_turn"||stage==="tool_observation"){
   postsendStructure=await observePostsendStructure(page).catch(()=>undefined);
   if(postsendStructure)postsendStructureDiagnostic=classifyPostsendStructure(postsendStructure);
  }
  if(stage==="tool_observation"){
   toolSignals=await observeToolDiagnostics(page).catch(()=>undefined);
   if(toolSignals)toolDiagnostic=classifyConnectorToolObservation(toolSignals);
   postsendSignals=await observePostsendSignals(page,page.locator('[contenteditable="true"][role="textbox"]').first()).catch(()=>undefined);
   if(postsendSignals)postsendDiagnostic=classifyConnectorPostsendState(postsendSignals);
  }
  // Neither raw answer nor error/URL/DOM/session/app list is logged.
  console.log(JSON.stringify({schema:"queqiao.gate3.connector-read-preflight.v1",
   runId:/^\d{1,20}$/.test(runId)?runId:"invalid",stage,status:"failed",
   appSelected,toolObserved,submitted,verdict,...(menuSignals?{menuSignals}:{}),...(preflightSignals?{preflightSignals}:{}),...(toolSignals?{toolSignals,toolDiagnostic}:{}),...(postsendSignals?{postsendSignals,postsendDiagnostic}:{}),...(userTurnSignals?{userTurnSignals}:{}),...(userTurnStructure?{userTurnStructure}:{}),...(draftSignals?{draftSignals}:{}),...(postsendStructure?{postsendStructure,postsendStructureDiagnostic}:{}),writeAttempted:false}));
  throw Error("G3_CONNECTOR_READ_FAILED_AT_"+stage.toUpperCase());
 }
}
