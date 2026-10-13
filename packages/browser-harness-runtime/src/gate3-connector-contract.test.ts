import {describe,it,expect} from "vitest";
import {createGate3ConnectorMarker,buildGate3ConnectorPrompt,assessGate3ConnectorEvidence} from "./gate3-connector-contract.js";
describe("Gate 3 ChatGPT GitHub Connector evidence (no independent credential)",()=>{
 it("binds a unique harmless marker to the exact hosted task attempt",()=>{
  expect(createGate3ConnectorMarker("38353538530","1")).toBe("QUEQIAO-GATE3-CONNECTOR-38353538530-1");
  expect(()=>createGate3ConnectorMarker("bad","1")).toThrow(/INVALID_RUN/);
  expect(()=>createGate3ConnectorMarker("2","other")).toThrow(/INVALID_RUN/);
 });
 it("requests exactly one read/write-limited action on the isolated draft PR, never a git push, token or production change",()=>{
  const prompt=buildGate3ConnectorPrompt("QUEQIAO-GATE3-CONNECTOR-38353538530-1");
  expect(prompt).toContain("GitHub Connector");
  expect(prompt).toContain("tibame201020/signal-notes");
  expect(prompt).toContain("#2");
  expect(prompt).toContain("QUEQIAO-GATE3-CONNECTOR-38353538530-1");
  expect(prompt).not.toMatch(/(?:PAT|GITHUB_TOKEN|SIGNAL_NOTES_GATE3_TOKEN|gh pr|git push)/);
  expect(prompt).toContain("Do not merge");
  expect(prompt).toContain("UNAVAILABLE");
 });
 it("accepts only independently observed exact public issue comment by authorized GitHub identity on the draft target PR",()=>{
  const marker=createGate3ConnectorMarker("38353538530","1");
  const base={draft:true,head:"gate3/synthetic-2026-10-13",base:"main",comments:[{body:marker,user:{login:"tibame201020"}}]};
  expect(assessGate3ConnectorEvidence(marker,base)).toBe("verified");
  expect(assessGate3ConnectorEvidence(marker,{...base,draft:false})).toBe("wrong_target");
  expect(assessGate3ConnectorEvidence(marker,{...base,head:"main"})).toBe("wrong_target");
  expect(assessGate3ConnectorEvidence(marker,{...base,comments:[]})).toBe("missing_comment");
  expect(assessGate3ConnectorEvidence(marker,{...base,comments:[{body:marker+" X",user:{login:"tibame201020"}}]})).toBe("missing_comment");
  expect(assessGate3ConnectorEvidence(marker,{...base,comments:[{body:marker,user:{login:"another"}}]})).toBe("missing_comment");
 });
});
