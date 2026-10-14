import type {Page,Locator} from "playwright-core";
import {normalizeAppMenuCounts,selectAppCandidateRole,type AppMenuSignals} from "./connector-app-menu.js";
import {assessConnectorPreflight,type ConnectorPreflightSignals} from "./connector-read-preflight-policy.js";
import {observeConnectorComposer} from "./connector-read-composer.js";
import {assessConnectorDraft,type ConnectorDraftSignals} from "./connector-presend-draft.js";
import {makeReadMarker,makeReadPrompt,assessReadLayers,shouldReloadConversation,type ReadLayerSignals} from "./connector-layered-proof.js";

/** One normal ChatGPT UI send. A matching SHA is UI evidence, NEVER by itself
 * an authenticated provider tool execution receipt. No API replay or writing.
 * Neither browser content, profile, screenshot nor URL is logged or persisted.
 */
const PUBLIC_MIDDLE="current default-branch HEAD commit SHA of public tibame201020/Queqiao";
const PUBLIC_TAIL="Reply with ONLY the exact 40 lowercase hexadecimal characters of that HEAD SHA.";
const CONVERSATION=/^https:\/\/chatgpt\.com\/c\/[a-z0-9-]+(?:[?#].*)?$/i;
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function visibleAny(loc:Locator):Promise<boolean>{
 const n=Math.min(await loc.count(),8);
 for(let i=0;i<n;i++)if(await loc.nth(i).isVisible().catch(()=>false))return true;
 return false;
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
 const counts={menu:Number(m),listbox:Number(l),dialog:Number(d),option:Number(await visibleAny(option)),
  menuitem:Number(await visibleAny(menuitem)),button:buttonCount,
  text:Number(await visibleAny(page.getByText("GitHub",{exact:true})))};
 return {signals:normalizeAppMenuCounts(counts),option,menuitem,button,buttonCount};
}
async function observeComposerDraft(editor:Locator,marker:string):Promise<ConnectorDraftSignals & {markerInEditor:boolean}>{
 const details=await editor.evaluate((el,p)=>{
  const active=el.ownerDocument.activeElement;
  const text=(el.textContent??"").replace(/\s+/g," ").trim();
  return {editorFocused:active===el||Boolean(active&&el.contains(active)),
   middleInEditor:text.includes(p.middle),tailInEditor:text.includes(p.tail),markerInEditor:text.includes(p.marker)};
 },{middle:PUBLIC_MIDDLE,tail:PUBLIC_TAIL,marker}).catch(()=>({
  editorFocused:false,middleInEditor:false,tailInEditor:false,markerInEditor:false,
 }));
 return {...details,editorEnabled:await editor.isEnabled().catch(()=>false)};
}
async function observeRenderedMarker(page:Page,marker:string):Promise<boolean>{
 const candidates=page.locator("main").getByText(marker,{exact:false});
 const n=Math.min(await candidates.count(),8);
 for(let i=0;i<n;i++){
  const c=candidates.nth(i);
  if(!await c.isVisible().catch(()=>false))continue;
  const valid=await c.evaluate((el,m)=>Boolean(el.textContent?.includes(m))&&
   !el.closest('[contenteditable="true"]')&&!el.closest('[data-message-author-role="assistant"]'),
   marker).catch(()=>false);
  if(valid)return true;
 }
 return false;
}
async function observeReply(page:Page):Promise<{reply:string;outside:boolean}>{
 const candidates=page.locator("main").getByText(/^[a-f0-9]{40}$|^UNAVAILABLE$/);
 const n=Math.min(await candidates.count(),8);
 for(let i=n-1;i>=0;i--){
  const c=candidates.nth(i);
  if(!await c.isVisible().catch(()=>false))continue;
  const outside=await c.evaluate(el=>!el.closest('[contenteditable="true"]')&&
   !el.closest('[data-message-author-role="user"],[class*="user-message"]')).catch(()=>false);
  if(!outside)continue;
  const reply=(await c.innerText().catch(()=>"")).trim();
  if(/^[a-f0-9]{40}$|^UNAVAILABLE$/.test(reply))return {reply,outside:true};
 }
 return {reply:"",outside:false};
}
async function observeToolUi(page:Page):Promise<boolean>{
 return visibleAny(page.locator('main [data-testid*="tool"],main [data-testid*="connector"]')
   .filter({hasText:/GitHub/i}));
}
type Stage="preflight"|"app_selection"|"draft_ready"|"submission"|"conversation"|"observation";
export async function runConnectorReadPreflight(page:Page,authenticated:boolean):Promise<void>{
 const runId=process.env["GITHUB_RUN_ID"]??"";
 const attempt=process.env["GITHUB_RUN_ATTEMPT"]??"";
 const expectedSha=process.env["CONNECTOR_EXPECTED_SHA"]??"";
 let stage:Stage="preflight",appSelected=false,submitted=false,reloaded=false;
 let menuSignals:AppMenuSignals|undefined,preflightSignals:ConnectorPreflightSignals|undefined;
 let draftSignals:(ConnectorDraftSignals&{markerInEditor:boolean})|undefined;
 let layers=assessReadLayers({
  appSelected:false,conversationCreated:false,markerOutsideComposer:false,composerCleared:false,
  reply:"",replyOutsideUserAndComposer:false,replyStable:false,expectedSha,
  toolUiObserved:false,providerReceiptVerified:false,
 });
 let replySeen=false,markerSeen=false,replyStable=false,toolUiObserved=false,receiptEmitted=false;
 try{
  const editor=page.locator('[contenteditable="true"][role="textbox"]').first();
  const blankStart=(()=>{try{return new URL(page.url()).pathname==="/";}catch{return false;}})();
  const composer=await observeConnectorComposer({
   waitForVisible:()=>editor.waitFor({state:"visible",timeout:15_000}),
   isVisible:()=>editor.isVisible(),isEnabled:()=>editor.isEnabled(),
  });
  preflightSignals={authenticated,runIdValid:/^\d{1,20}$/.test(runId),
   expectedShaValid:/^[a-f0-9]{40}$/.test(expectedSha),blankStart,...composer};
  if(assessConnectorPreflight(preflightSignals)!=="ready"||!/^\d{1,20}$/.test(attempt))
   throw Error("preflight");
  const marker=makeReadMarker(runId,attempt);
  const prompt=makeReadPrompt(marker);
  stage="app_selection";
  const baselineGithubButtonVisible=await visibleAny(page.getByRole("button",{name:/^GitHub(?:\b|$)/i}));
  await editor.fill("@GitHub");
  await sleep(1000);
  const observation=await observeAppMenu(page);
  menuSignals=observation.signals;
  const role=selectAppCandidateRole(menuSignals,{baselineGithubButtonVisible,
   afterGithubButtonCount:observation.buttonCount});
  if(role==="none")throw Error("native_app_option_not_observed");
  await (role==="option"?observation.option:role==="menuitem"?observation.menuitem:observation.button).first().click();
  appSelected=true;
  await editor.press("End");
  await editor.press("Space");
  await page.keyboard.insertText(prompt);
  stage="draft_ready";
  draftSignals=await observeComposerDraft(editor,marker);
  if(assessConnectorDraft(draftSignals)!=="ready"||!draftSignals.markerInEditor)throw Error("draft_unconfirmed");
  stage="submission";
  await editor.press("Enter"); // Once only. Never repeat a possibly delivered user turn.
  submitted=true;
  stage="conversation";
  await page.waitForURL(CONVERSATION,{timeout:30_000});
  const conversationUrl=page.url(); // In-memory route only; never printed or persisted.
  stage="observation";
  let previousReply="",stable=0;
  let current:ReadLayerSignals={
   appSelected,conversationCreated:true,markerOutsideComposer:false,composerCleared:false,
   reply:"",replyOutsideUserAndComposer:false,replyStable:false,expectedSha,
   toolUiObserved:false,providerReceiptVerified:false,
  };
  // Normal visible UI only; observe even if a brittle native role selector is absent.
  // A page reload is allowed ONCE only after generation has settled, with NO resend.
  for(let i=0;i<70;i++){
   const stop=page.getByRole("button",{name:/^(Stop|停止|停止生成)$/i});
   const generating=await visibleAny(stop);
   const composerReady=await editor.isEnabled().catch(()=>false);
   markerSeen=await observeRenderedMarker(page,marker);
   const draft=(await editor.innerText().catch(()=>marker));
   const composerCleared=!draft.includes(marker);
   const answer=await observeReply(page);
   replySeen=answer.outside;
   if(answer.reply&&answer.reply===previousReply&&!generating&&composerReady)stable++;else stable=0;
   previousReply=answer.reply;
   replyStable=stable>=2;
   toolUiObserved=await observeToolUi(page);
   current={appSelected,conversationCreated:true,markerOutsideComposer:markerSeen,composerCleared,
    reply:answer.reply,replyOutsideUserAndComposer:answer.outside,replyStable,expectedSha,
    toolUiObserved,providerReceiptVerified:false};
   layers=assessReadLayers(current);
   if(layers.l1==="confirmed"&&layers.l2==="confirmed")break;
   if(i>=13&&!markerSeen&&shouldReloadConversation({
    conversationCreated:true,reloaded,generating,composerReady,
    sameConversationUrl:page.url()===conversationUrl&&CONVERSATION.test(page.url()),
   })){
    reloaded=true; // Set before action: never reload twice even if navigation times out.
    await page.reload({waitUntil:"domcontentloaded",timeout:30_000});
    if(page.url()!==conversationUrl)throw Error("conversation_changed");
   }
   await sleep(1500);
  }
  const status=layers.l1==="confirmed"&&layers.l2==="confirmed"?"ui_verified":"observer_unconfirmed";
  console.log(JSON.stringify({schema:"queqiao.gate3.connector-layered.v1",
   runId,attempt,status,stage,appSelected,submitted,reloaded,markerSeen,replySeen,replyStable,
   l1:layers.l1,l2:layers.l2,l3:layers.l3,toolUiObserved:layers.toolUiObserved,
   providerReceiptVerified:false,writeAttempted:false}));
  receiptEmitted=true;
  if(status!=="ui_verified")throw Error("G3_CONNECTOR_OBSERVER_UNCONFIRMED");
  // UI POC only. Provider tool provenance is explicitly NOT PROVED.
 }catch{
  if(!receiptEmitted){
   console.log(JSON.stringify({schema:"queqiao.gate3.connector-layered.v1",
    runId:/^\d{1,20}$/.test(runId)?runId:"invalid",attempt:/^\d{1,20}$/.test(attempt)?attempt:"invalid",
    status:"observer_unconfirmed",stage,appSelected,submitted,reloaded,
    ...(menuSignals?{menuSignals}:{}),...(preflightSignals?{preflightSignals}:{}),
    ...(draftSignals?{draftSignals}:{}),markerSeen,replySeen,replyStable,
    l1:layers.l1,l2:layers.l2,l3:layers.l3,
    providerReceiptVerified:false,writeAttempted:false}));
  }
  // Do not expose Playwright errors: they can contain private URLs or page content.
  throw Error("G3_CONNECTOR_READ_UNCONFIRMED_AT_"+stage.toUpperCase());
 }
}
