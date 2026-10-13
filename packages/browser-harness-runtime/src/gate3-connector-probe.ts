import {appendFileSync} from "node:fs";
import type {Page} from "playwright-core";
import {createGate3ConnectorMarker,buildGate3ConnectorPrompt} from "./gate3-connector-contract.js";

const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/** Browser-only Connector attempt. Response text is never accepted as proof of GitHub mutation. */
export async function runGate3ConnectorProbe(page:Page,sessionConfirmed:boolean):Promise<void>{
 const runId=process.env["GITHUB_RUN_ID"]??"";
 const attempt=process.env["GITHUB_RUN_ATTEMPT"]??"";
 const marker=createGate3ConnectorMarker(runId,attempt);
 const prompt=buildGate3ConnectorPrompt(marker);
 let stage="preflight",submitted=false,userTurn=false,assistantTurn=false,completed=false;
 const summary=process.env["GITHUB_STEP_SUMMARY"];
 try{
  if(!sessionConfirmed||!/^https:\/\/chatgpt\\.com\/c\/[a-z0-9-]+(?:[?#].*)?$/i.test(page.url()))
   throw Error("not_authenticated_conversation");
  const editor=page.locator('[contenteditable="true"][role="textbox"]').first();
  await editor.waitFor({state:"visible",timeout:15000});
  if(!await editor.isEnabled())throw Error("composer_disabled");
  stage="submit";
  await editor.fill(prompt);
  await editor.press("Enter"); // One send, never retry after uncertainty.
  submitted=true;
  stage="user_turn";
  await page.locator("main").getByText(prompt,{exact:true}).first().waitFor({state:"visible",timeout:20000});
  userTurn=true;
  stage="assistant";
  const answer=page.locator("main").getByText(new RegExp("^(?:"+marker+"|UNAVAILABLE)$")).last();
  await answer.waitFor({state:"visible",timeout:120000});
  const userOwned=await answer.evaluate(el=>Boolean(el.closest(
   '[data-message-author-role="user"],[class*="user-message"]'
  ))).catch(()=>true);
  if(userOwned)throw Error("not_assistant");
  let candidate=(await answer.innerText()).trim();
  if(candidate!==marker)throw Error("connector_unavailable");
  assistantTurn=true;
  stage="completion";
  const stop=page.getByRole("button",{name:/^(Stop|停止|停止生成)$/i});
  let stable=0;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
   await sleep(1500);
   const current=(await answer.innerText().catch(()=>"")).trim();
   const busy=await stop.first().isVisible().catch(()=>false);
   const ready=await editor.isEnabled().catch(()=>false);
   stable=(current===marker&&!busy&&ready)?stable+1:0;
   if(stable>=2)break;
  }
  completed=stable>=2;
  if(!completed)throw Error("not_completed");
  // This is only a browser-side claim. CI MUST check GitHub public issue comments.
  console.log(JSON.stringify({schema:"queqiao.gate3.connector-probe.v1",runId,
   taskId:`gate3-${runId}-${attempt}`,stage:"awaiting_external_proof",
   submitted,userTurnObserved:userTurn,assistantObserved:assistantTurn,generationCompleted:completed,
   verified:false}));
  if(summary)appendFileSync(summary,
   "### Gate 3 Connector — awaiting independent GitHub proof\nBrowser claim is not publication evidence.\n","utf8");
 }catch{
  const errorCode="GATE3_CONNECTOR_FAILED_AT_"+stage.toUpperCase();
  console.log(JSON.stringify({schema:"queqiao.gate3.connector-probe.v1",runId,
   taskId:`gate3-${runId}-${attempt}`,stage,status:"failed",
   submitted,userTurnObserved:userTurn,assistantObserved:assistantTurn,generationCompleted:completed,
   errorCode,verified:false}));
  throw Error(errorCode); // No raw DOM, URL, Playwright or token in logs.
 }
}
