/** Fail-closed receipt policy. Inputs are synthetic-safe metadata, never raw cookies. */
export type Gate2Observation={
  confirmedSession:boolean;composerReady:boolean;blankStart:boolean;
  promptSubmittedOnce:boolean;userPromptObserved:boolean;conversationCreated:boolean;
  assistantAnswer:string;answerOutsideUserMessage:boolean;
  generationFinished:boolean;stableAnswer:boolean;
};
export type Gate2Verdict="pass"|"session"|"composer"|"blank_start"|"submission"|
  "user_turn"|"conversation"|"answer"|"answer_role"|"completion"|"stability";

export function assessGate2(e:Gate2Observation):Gate2Verdict{
  if(!e.confirmedSession)return "session";
  if(!e.composerReady)return "composer";
  if(!e.blankStart)return "blank_start";
  if(!e.promptSubmittedOnce)return "submission";
  if(!e.userPromptObserved)return "user_turn";
  if(!e.conversationCreated)return "conversation";
  if(e.assistantAnswer.trim()!=="45")return "answer";
  if(!e.answerOutsideUserMessage)return "answer_role";
  if(!e.generationFinished)return "completion";
  if(!e.stableAnswer)return "stability";
  return "pass";
}
