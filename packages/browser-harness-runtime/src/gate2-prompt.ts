import {appendFileSync} from "node:fs";
import type {Page} from "playwright-core";
import {assessGate2,type Gate2Observation} from "./gate2-verdict.js";
import {createGate2Receipt,formatGate2Summary,type Gate2Receipt,type Gate2Stage} from "./gate2-receipt.js";
import {observeGate3Composer} from "./gate3-composer.js";
import {assessAbControlPreflight,type AbControlPreflightSignals} from "./ab-control-preflight.js";

const PROMPT="Calculate 17 + 28. Reply with only the decimal number. Do not repeat the question.";
const ANSWER="45";
const CONVERSATION=/^https:\/\/chatgpt\.com\/c\/[a-z0-9-]+(?:[?#].*)?$/i;
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));

/** Exactly one synthetic prompt in a blank conversation. Never log browser data,
 * URLs, identities or Playwright exceptions. A failed/uncertain send is not retried.
 */
export async function runGate2Prompt(page:Page,sessionConfirmed:boolean):Promise<Gate2Receipt>{
  let stage:Gate2Stage="preflight";
  const evidence:Gate2Observation={
    confirmedSession:sessionConfirmed,composerReady:false,blankStart:false,
    promptSubmittedOnce:false,userPromptObserved:false,conversationCreated:false,
    assistantAnswer:"",answerOutsideUserMessage:false,generationFinished:false,stableAnswer:false,
  };
  let preflightSignals:AbControlPreflightSignals|undefined;
  const runId=process.env["GITHUB_RUN_ID"];
  const runAttempt=process.env["GITHUB_RUN_ATTEMPT"];
  const summary=process.env["GITHUB_STEP_SUMMARY"];
  try{
    evidence.blankStart=new URL(page.url()).pathname==="/";
    const editor=page.locator('[contenteditable="true"][role="textbox"]').first();
    const composer=await observeGate3Composer({
      waitForVisible:()=>editor.waitFor({state:"visible",timeout:15_000}),
      isVisible:()=>editor.isVisible(),
      isEnabled:()=>editor.isEnabled(),
    });
    preflightSignals={
      authenticated:sessionConfirmed,blankStart:evidence.blankStart,
      editorVisible:composer.editorVisible,editorEnabled:composer.editorEnabled,
    };
    evidence.composerReady=composer.editorVisible&&composer.editorEnabled;
    if(assessAbControlPreflight(preflightSignals)!=="ready")throw Error("preflight");

    stage="submit";
    await editor.fill(PROMPT);
    // Exactly one send action. Never retry an uncertain press.
    await editor.press("Enter");
    evidence.promptSubmittedOnce=true;

    stage="user_turn";
    const promptInPage=page.locator("main").getByText(PROMPT,{exact:true}).first();
    await promptInPage.waitFor({state:"visible",timeout:20000});
    evidence.userPromptObserved=true;

    stage="conversation";
    await page.waitForURL(CONVERSATION,{timeout:30000});
    evidence.conversationCreated=true;

    stage="assistant";
    const answer=page.locator("main").getByText(ANSWER,{exact:true}).first();
    await answer.waitFor({state:"visible",timeout:90000});
    evidence.assistantAnswer=(await answer.innerText()).trim();
    evidence.answerOutsideUserMessage=await answer.evaluate(el=>
      el.closest('[data-message-author-role="user"],[class*="user-message"]')===null
    );

    stage="completion";
    const stop=page.getByRole("button",{name:/^(Stop|停止|停止生成)$/i});
    const deadline=Date.now()+30000;
    let stable=0;
    while(Date.now()<deadline){
      await sleep(1500);
      const current=await answer.innerText().catch(()=>"");
      const busy=await stop.first().isVisible().catch(()=>false);
      const activeComposer=await editor.isEnabled().catch(()=>false);
      if(current.trim()===ANSWER && !busy && activeComposer)stable++;
      else stable=0;
      if(stable>=2)break;
    }
    evidence.stableAnswer=stable>=2;
    evidence.generationFinished=stable>=2;
    if(assessGate2(evidence)!=="pass")throw Error("acceptance");

    const receipt=createGate2Receipt({runId,runAttempt,stage:"completed",evidence});
    if(receipt.status!=="completed")throw Error("receipt_validation");
    stage="receipt";
    if(summary)appendFileSync(summary,formatGate2Summary(receipt),"utf8");
    return receipt;
  }catch{
    // The stage and boolean-only evidence are bounded; never serialize the caught
    // exception because Playwright errors may contain private page URLs.
    const receipt=createGate2Receipt({runId,runAttempt,stage,evidence});
    console.log(JSON.stringify({...receipt,...(stage==="preflight"&&preflightSignals?{preflightSignals}:{} )}));
    if(summary){
      try{appendFileSync(summary,formatGate2Summary(receipt),"utf8");}catch{/* log receipt remains durable */}
    }
    throw new Error(receipt.errorCode??"GATE2_FAILED_AT_RECEIPT");
  }
}
