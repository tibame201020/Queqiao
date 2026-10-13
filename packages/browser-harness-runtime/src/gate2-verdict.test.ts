import {describe,it,expect} from "vitest";
import {assessGate2, type Gate2Observation} from "./gate2-verdict.js";

const good:Gate2Observation={
  confirmedSession:true,composerReady:true,blankStart:true,
  promptSubmittedOnce:true,userPromptObserved:true,conversationCreated:true,
  assistantAnswer:"45",answerOutsideUserMessage:true,
  generationFinished:true,stableAnswer:true,
};

describe("Gate 2 synthetic prompt and actual answer acceptance",()=>{
  it("accepts only authenticated, sent-once, finished real assistant 45",()=>{
    expect(assessGate2(good)).toBe("pass");
  });
  it.each([
    ["not_authenticated",{confirmedSession:false},"session"],
    ["guest_composer",{composerReady:false},"composer"],
    ["existing_thread",{blankStart:false},"blank_start"],
    ["not_submitted",{promptSubmittedOnce:false},"submission"],
    ["duplicate_submission",{promptSubmittedOnce:false},"submission"],
    ["prompt_not_observed",{userPromptObserved:false},"user_turn"],
    ["no_conversation",{conversationCreated:false},"conversation"],
    ["wrong_answer",{assistantAnswer:"44"},"answer"],
    ["marker_echo",{assistantAnswer:"45",answerOutsideUserMessage:false},"answer_role"],
    ["unfinished",{generationFinished:false},"completion"],
    ["unstable",{stableAnswer:false},"stability"],
    ["no_answer",{assistantAnswer:""},"answer"],
  ] as const)("rejects %s",(_label,delta,expected)=>{
    expect(assessGate2({...good,...delta})).toBe(expected);
  });
});
