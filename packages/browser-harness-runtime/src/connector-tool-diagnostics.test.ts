import {describe,it,expect} from "vitest";
import {classifyConnectorToolObservation} from "./connector-tool-diagnostics.js";
const none={githubCardVisible:false,genericToolCardVisible:false,assistantShaVisible:false,assistantUnavailableVisible:false};
describe("G3.3 sanitized read-only tool/answer evidence remains fail closed",()=>{
 it("never treats an Assistant SHA or claim as actual tool proof",()=>{
  expect(classifyConnectorToolObservation({...none,assistantShaVisible:true})).toBe("assistant_sha_without_tool");
  expect(classifyConnectorToolObservation({...none,assistantUnavailableVisible:true})).toBe("assistant_unavailable_without_tool");
 });
 it("distinguishes generic unattributed card, GitHub-labeled card, and absent reply",()=>{
  expect(classifyConnectorToolObservation(none)).toBe("no_observed_reply");
  expect(classifyConnectorToolObservation({...none,genericToolCardVisible:true})).toBe("tool_card_unattributed");
  expect(classifyConnectorToolObservation({...none,genericToolCardVisible:true,githubCardVisible:true})).toBe("github_card_observed");
 });
});
