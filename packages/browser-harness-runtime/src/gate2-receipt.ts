import {createHash} from "node:crypto";
import {assessGate2,type Gate2Observation} from "./gate2-verdict.js";

export type Gate2Stage="preflight"|"submit"|"user_turn"|"conversation"|"assistant"|"completion"|"receipt"|"completed";
export type Gate2Receipt={
  schema:"queqiao.gate2.receipt.v1";gate:"gate2";runId:string;taskId:string;
  status:"completed"|"failed";stage:Gate2Stage;completed:boolean;verdict:"pass"|"fail";
  promptSubmittedOnce:boolean;userTurnObserved:boolean;conversationCreated:boolean;
  assistantObserved:boolean;generationCompleted:boolean;
  answerSha256?:string;errorCode?:string;
};
const ANSWER_HASH=createHash("sha256").update("45","utf8").digest("hex");
const safeId=(value:string|undefined,fallback:string)=>
  value && /^\d{1,20}$/.test(value) ? value : fallback;

/** Accept only pre-validated synthetic metadata; never persist browser data or raw text. */
export function createGate2Receipt({runId,runAttempt,stage,evidence}:{
  runId?:string;runAttempt?:string;stage:Gate2Stage;evidence:Gate2Observation;
}):Gate2Receipt{
  const id=safeId(runId,"local");
  const attempt=safeId(runAttempt,"1");
  const pass=stage==="completed" && assessGate2(evidence)==="pass";
  const finalStage=pass ? "completed" : stage==="completed" ? "completion" : stage;
  return {
    schema:"queqiao.gate2.receipt.v1",gate:"gate2",
    runId:id,taskId:`gate2-${id}-${attempt}`,
    status:pass?"completed":"failed",stage:finalStage,completed:pass,
    verdict:pass?"pass":"fail",
    promptSubmittedOnce:evidence.promptSubmittedOnce,
    userTurnObserved:evidence.userPromptObserved,
    conversationCreated:evidence.conversationCreated,
    assistantObserved:evidence.assistantAnswer.trim().length>0 && evidence.answerOutsideUserMessage,
    generationCompleted:evidence.generationFinished && evidence.stableAnswer,
    ...(pass?{answerSha256:ANSWER_HASH}:{errorCode:"GATE2_FAILED_AT_"+finalStage.toUpperCase()}),
  };
}

export function formatGate2Summary(receipt:Gate2Receipt):string{
  return [
    "### Gate 2 — real UI prompt and completion",
    "- Task ID: "+receipt.taskId,
    "- GitHub run ID: "+receipt.runId,
    "- Status: "+receipt.status,
    "- Stage: "+receipt.stage,
    "- Completed: "+receipt.completed,
    "- Prompt submitted once: "+receipt.promptSubmittedOnce,
    "- User turn observed: "+receipt.userTurnObserved,
    "- Conversation created: "+receipt.conversationCreated,
    "- Assistant observed: "+receipt.assistantObserved,
    "- Generation completed: "+receipt.generationCompleted,
    ...(receipt.answerSha256?["- Synthetic answer SHA-256: "+receipt.answerSha256]:[]),
    ...(receipt.errorCode?["- Error code: "+receipt.errorCode]:[]),
    "- No conversation content, account data or session material recorded.",
    "",
  ].join("\n");
}
