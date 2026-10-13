import {createHash} from "node:crypto";
import {appendFileSync} from "node:fs";
import type {Page} from "playwright-core";
import {assessGate2,type Gate2Observation} from "./gate2-verdict.js";

const PROMPT="Calculate 17 + 28. Reply with only the decimal number. Do not repeat the question.";
const ANSWER="45";
const CONVERSATION=/^https:\/\/chatgpt\.com\/c\/[a-z0-9-]+(?:[?#].*)?$/i;

type Gate2Receipt={
  gate:"gate2";runId:string;verdict:"pass";promptSubmittedOnce:true;
  userTurnObserved:true;assistantObserved:true;generationCompleted:true;
  answerSha256:string;conversationCreated:true;
};
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));

/** Exactly one synthetic, public prompt in a fresh conversation.
 * Never print browser content, user identifiers, URL, Cookies or LocalStorage.
 * A guest Composer, echo, timeout or interrupted stream cannot pass.
 */
export async function runGate2Prompt(page:Page,sessionConfirmed:boolean):Promise<Gate2Receipt>{
  let stage="preflight";
  const evidence:Gate2Observation={
    confirmedSession:sessionConfirmed,composerReady:false,blankStart:false,
    promptSubmittedOnce:false,userPromptObserved:false,conversationCreated:false,
    assistantAnswer:"",answerOutsideUserMessage:false,generationFinished:false,stableAnswer:false,
  };
  try{
    evidence.blankStart=new URL(page.url()).pathname==="/";
    const editor=page.locator('[contenteditable="true"][role="textbox"]').first();
    evidence.composerReady=await editor.isVisible() && await editor.isEnabled();
    if(!sessionConfirmed || !evidence.blankStart || !evidence.composerReady)
      throw Error("preflight");

    stage="submit";
    await editor.fill(PROMPT);
    // One send action only. Never retry when outcome is uncertain.
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
      // A response must be the same across two observations AFTER Stop disappears.
      const current=await answer.innerText().catch(()=>"");
      const busy=await stop.first().isVisible().catch(()=>false);
      const activeComposer=await editor.isEnabled().catch(()=>false);
      if(current.trim()===ANSWER && !busy && activeComposer)stable++;
      else stable=0;
      if(stable>=2)break;
    }
    evidence.stableAnswer=stable>=2;
    evidence.generationFinished=stable>=2;
    const verdict=assessGate2(evidence);
    if(verdict!=="pass")throw Error("acceptance_"+verdict);

    const receipt:Gate2Receipt={
      gate:"gate2",runId:process.env["GITHUB_RUN_ID"]??"local",
      verdict:"pass",promptSubmittedOnce:true,userTurnObserved:true,
      assistantObserved:true,generationCompleted:true,
      answerSha256:createHash("sha256").update(ANSWER,"utf8").digest("hex"),
      conversationCreated:true,
    };
    const summary=process.env["GITHUB_STEP_SUMMARY"];
    if(summary){
      appendFileSync(summary,[
        "### Gate 2 — real UI prompt and completion",
        "- Result: PASS (confirmed session, one user turn, independent assistant answer, finished generation)",
        "- Synthetic answer SHA-256: "+receipt.answerSha256,
        "- GitHub run ID: "+receipt.runId,
        "- No conversation content, account data or session material recorded.",
        "",
      ].join("\n"),"utf8");
    }
    return receipt;
  }catch{
    // Do not serialize Playwright/browser errors: they can include private URLs.
    throw new Error("GATE2_FAILED_AT_"+stage);
  }
}
