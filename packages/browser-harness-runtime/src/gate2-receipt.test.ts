import {describe,expect,it} from "vitest";
import {createGate2Receipt,formatGate2Summary} from "./gate2-receipt.js";
import type {Gate2Observation} from "./gate2-verdict.js";

const evidence:Gate2Observation={
  confirmedSession:true,composerReady:true,blankStart:true,
  promptSubmittedOnce:true,userPromptObserved:true,conversationCreated:true,
  assistantAnswer:"45",answerOutsideUserMessage:true,
  generationFinished:true,stableAnswer:true,
};
const run={runId:"38345287596",runAttempt:"1"};

describe("Gate 2 durable sanitized receipt",()=>{
  it("records task identity, lifecycle, completion and verified answer hash",()=>{
    const receipt=createGate2Receipt({...run,stage:"completed",evidence});
    expect(receipt).toMatchObject({
      schema:"queqiao.gate2.receipt.v1",gate:"gate2",runId:run.runId,
      taskId:"gate2-38345287596-1",status:"completed",stage:"completed",
      completed:true,verdict:"pass",promptSubmittedOnce:true,
      userTurnObserved:true,assistantObserved:true,generationCompleted:true,
      conversationCreated:true,
      answerSha256:"811786ad1ae74adfdd20dd0372abaaebc6246e343aebd01da0bfc4c02bf0106c",
    });
    expect(receipt).not.toHaveProperty("errorCode");
    const text=JSON.stringify(receipt)+formatGate2Summary(receipt);
    expect(text).not.toContain("Calculate 17");
    expect(text).not.toContain("chatgpt.com/c/");
  });
  it.each(["preflight","submit","user_turn","conversation","assistant","completion","receipt"] as const)(
    "fails closed at %s with sanitized code and an incomplete receipt",stage=>{
      const receipt=createGate2Receipt({...run,stage,evidence});
      expect(receipt).toMatchObject({
        status:"failed",stage,completed:false,verdict:"fail",
        errorCode:"GATE2_FAILED_AT_"+stage.toUpperCase(),
      });
      expect(receipt).not.toHaveProperty("answerSha256");
      expect(formatGate2Summary(receipt)).toContain(receipt.errorCode);
    }
  );
  it("does not mark a completed stage as success when observation is partial, unauthenticated, wrong or challenged",()=>{
    for(const delta of [
      {confirmedSession:false},{composerReady:false},{promptSubmittedOnce:false},
      {userPromptObserved:false},{conversationCreated:false},
      {assistantAnswer:"4"},{answerOutsideUserMessage:false},
      {generationFinished:false},{stableAnswer:false},
    ]){
      const receipt=createGate2Receipt({...run,stage:"completed",evidence:{...evidence,...delta}});
      expect(receipt.status).toBe("failed");
      expect(receipt.completed).toBe(false);
      expect(receipt).not.toHaveProperty("answerSha256");
    }
  });
  it("uses stable task identity within an attempt; separates reruns and sanitizes environment identifiers",()=>{
    const one=createGate2Receipt({...run,stage:"completed",evidence});
    expect(createGate2Receipt({...run,stage:"completed",evidence}).taskId).toBe(one.taskId);
    expect(createGate2Receipt({...run,runAttempt:"2",stage:"completed",evidence}).taskId).not.toBe(one.taskId);
    const unsafe=createGate2Receipt({runId:"123\nPRIVATE",runAttempt:"2\nPRIVATE",stage:"preflight",evidence});
    expect(unsafe.runId).toBe("local");
    expect(unsafe.taskId).toBe("gate2-local-1");
    expect(formatGate2Summary(unsafe)).not.toContain("PRIVATE");
  });
});
