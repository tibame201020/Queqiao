import {appendFileSync,mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import type {Page} from "playwright-core";
import {makeGate3Artifact,validateGate3Output,assessGate3Handoff,type Gate3Receipt} from "./gate3-content.js";
import {assessGate3Preflight,type Gate3PreflightSignals,type Gate3PreflightVerdict} from "./gate3-preflight.js";
import {createGate3Trace} from "./gate3-trace.js";
import {observeGate3Composer} from "./gate3-composer.js";
import {isGate3AssistantCandidate,assessGate3AssistantSignals} from "./gate3-assistant-observation.js";

const PROMPT=[
 "This is one harmless synthetic publishing pipeline test, not a request for news or personal context.",
 "Respond with ONLY one single-line JSON object. Exactly three keys: concept, verification, limitation.",
 "Each value must be an original Traditional Chinese sentence between 25 and 90 characters, consisting only of Chinese characters and Chinese punctuation, with no newlines, English, digits, names, URLs or personal information.",
 "Explain test-driven development: concept = what it is; verification = how to validate red/green/refactor; limitation = why this synthetic sample is not research or a production article.",
 "Do not use Markdown, code fences or text outside JSON. Do not quote this prompt."
].join(" ");
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const CONVERSATION=/^https:\/\/chatgpt\.com\/c\/[a-z0-9-]+(?:[?#].*)?$/i;
type Stage="preflight"|"submit"|"user_turn"|"conversation"|"assistant"|"completion"|"validation"|"artifact";
const safeId=(v:string|undefined,d:string)=>v&&/^\d{1,20}$/.test(v)?v:d;

/** A single synthetic UI task. Never retries after Enter, follows challenges, or logs raw page data. */
export async function runGate3Prompt(page:Page,sessionConfirmed:boolean):Promise<Gate3Receipt>{
 let stage:Stage="preflight";
 let submitted=false,userTurn=false,assistantTurn=false,finished=false;
 let preflightSignals:Gate3PreflightSignals|undefined;
 let preflightVerdict:Gate3PreflightVerdict|"not_checked"="not_checked";
 const runId=safeId(process.env["GITHUB_RUN_ID"],"local");
 const attempt=safeId(process.env["GITHUB_RUN_ATTEMPT"],"1");
 const taskId=`gate3-${runId}-${attempt}`;
 const summary=process.env["GITHUB_STEP_SUMMARY"];
 try{
  const editor=page.locator('[contenteditable="true"][role="textbox"]').first();
  // Wait only for the existing Composer to become visible; this precedes any send.
  // A timeout is a failed preflight, never a reason to try another selector or submit.
  const composer=await observeGate3Composer({
   waitForVisible:()=>editor.waitFor({state:"visible",timeout:15_000}),
   isVisible:()=>editor.isVisible(),
   isEnabled:()=>editor.isEnabled(),
  });
  preflightSignals={
   sessionConfirmed,
   blankStart:new URL(page.url()).pathname==="/",
   ...composer,
  };
  preflightVerdict=assessGate3Preflight(preflightSignals);
  if(preflightVerdict!=="ready")throw Error("preflight");
  stage="submit";
  await editor.fill(PROMPT);
  await editor.press("Enter"); // Exactly one send; uncertain submission must fail closed.
  submitted=true;
  stage="user_turn";
  await page.locator("main").getByText(PROMPT,{exact:true}).first().waitFor({state:"visible",timeout:20000});
  userTurn=true;
  stage="conversation";
  await page.waitForURL(CONVERSATION,{timeout:30000});
  stage="assistant";
  // Identify the generated JSON response semantically, without assuming an
  // undocumented Assistant role attribute. The request contains no JSON pairs.
  const answer=page.locator("main").getByText(/"(?:concept|verification|limitation)"\s*:/).last();
  await answer.waitFor({state:"visible",timeout:90000});
  const userOwned=await answer.evaluate(el=>Boolean(el.closest(
   '[data-message-author-role="user"],[class*="user-message"]'
  ))).catch(()=>true);
  let candidate=(await answer.innerText()).trim();
  if(!isGate3AssistantCandidate({text:candidate,prompt:PROMPT,isUserTurn:userOwned}))
   throw Error("not_assistant_candidate");
  assistantTurn=true;
  stage="completion";
  const stop=page.getByRole("button",{name:/^(Stop|停止|停止生成)$/i});
  const deadline=Date.now()+60000;
  let stable=0;
  while(Date.now()<deadline){
   await sleep(1500);
   const current=(await answer.innerText().catch(()=>"")).trim();
   const busy=await stop.first().isVisible().catch(()=>false);
   const composerReady=await editor.isEnabled().catch(()=>false);
   if(isGate3AssistantCandidate({text:current,prompt:PROMPT,isUserTurn:userOwned}) &&
      current===candidate)stable++;else stable=0;
   candidate=current;
   if(assessGate3AssistantSignals({
    candidateObserved:true,stable:stable>=2,stopVisible:busy,composerReady,
   })==="completed")break;
  }
  finished=stable>=2 && await stop.first().isVisible().then(v=>!v).catch(()=>false)
    && await editor.isEnabled().catch(()=>false);
  if(!finished)throw Error("unfinished");
  stage="validation";
  const fields=validateGate3Output(candidate);
  const date=process.env["GATE3_DATE"]??"";
  const artifact=makeGate3Artifact({
   runId,runAttempt:attempt,date,fields,authenticated:sessionConfirmed,
   userTurn,assistantTurn,generationFinished:finished,
  });
  stage="artifact";
  if(assessGate3Handoff(artifact)!=="ready_for_connector")throw Error("invalid_handoff");
  const dir=process.env["GATE3_OUTPUT_DIR"];
  if(!dir)throw Error("missing_output");
  mkdirSync(dir,{recursive:true,mode:0o700});
  // The only durable content is the narrowly validated public synthetic post
  // and immutable provenance. Unobserved Worker/Connector/CI/Lease remain explicit.
  const persisted={...artifact,trace:createGate3Trace(artifact)};
  writeFileSync(join(dir,"gate3-artifact.json"),JSON.stringify(persisted)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
  if(summary)appendFileSync(summary,[
   "### Gate 3 — synthetic draft artifact",
   "- Run ID: "+runId,"- Task ID: "+taskId,
   "- Stage: validated; generated content observed after real completed Assistant turn",
   "- Article SHA-256: "+artifact.receipt.articleSha256,
   "- Draft only; signal-notes publication is not implied.",""
  ].join("\n"),"utf8");
  return artifact.receipt;
 }catch{
  // Never log raw Playwright errors, browser URL or model response.
  const receipt={schema:"queqiao.gate3.receipt.v1",runId,taskId,status:"failed",stage,
   completed:false,submitted,userTurn,assistantTurn,finished,errorCode:"GATE3_FAILED_AT_"+stage.toUpperCase(),
   ...(stage==="preflight"&&preflightSignals?{preflightVerdict,preflightSignals}:{}),};
  console.log(JSON.stringify(receipt));
  if(summary){try{appendFileSync(summary,[
   "### Gate 3 — failed", "- Task ID: "+taskId,"- Error: "+receipt.errorCode,""
  ].join("\n"),"utf8");}catch{/* bounded failure log already emitted */}}
  throw Error(receipt.errorCode);
 }
}
