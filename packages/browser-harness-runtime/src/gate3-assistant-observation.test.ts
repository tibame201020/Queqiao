import {describe,it,expect} from "vitest";
import {isGate3AssistantCandidate,assessGate3AssistantSignals} from "./gate3-assistant-observation.js";

const prompt="Respond with ONLY one single-line JSON object. Exactly three keys: concept, verification, limitation.";
const generated='{"concept":"測試驅動開發先寫測試，將規格變成可以執行的驗收條件。","verification":"先確認紅燈，再讓測試變綠，最後執行回歸與重構。","limitation":"合成內容僅供工作流驗證，並不是新聞研究或正式發布文章。"}';
describe("Gate 3 assistant semantic observation",()=>{
 it("identifies generated structured response independently of role-specific DOM",()=>{
  expect(isGate3AssistantCandidate({text:generated,prompt,isUserTurn:false})).toBe(true);
 });
 it("never mistakes request, user turn, incomplete keyless text, or huge DOM aggregate for assistant",()=>{
  expect(isGate3AssistantCandidate({text:prompt,prompt,isUserTurn:false})).toBe(false);
  expect(isGate3AssistantCandidate({text:generated,prompt,isUserTurn:true})).toBe(false);
  expect(isGate3AssistantCandidate({text:"Loading...",prompt,isUserTurn:false})).toBe(false);
  expect(isGate3AssistantCandidate({text:generated.repeat(10),prompt,isUserTurn:false})).toBe(false);
 });
 it("separates absent response from candidate and completed answer",()=>{
  expect(assessGate3AssistantSignals({candidateObserved:false,stable:false,stopVisible:false,composerReady:true})).toBe("not_observed");
  expect(assessGate3AssistantSignals({candidateObserved:true,stable:false,stopVisible:true,composerReady:false})).toBe("generating");
  expect(assessGate3AssistantSignals({candidateObserved:true,stable:true,stopVisible:true,composerReady:true})).toBe("generating");
  expect(assessGate3AssistantSignals({candidateObserved:true,stable:true,stopVisible:false,composerReady:false})).toBe("generating");
  expect(assessGate3AssistantSignals({candidateObserved:true,stable:true,stopVisible:false,composerReady:true})).toBe("completed");
 });
});
