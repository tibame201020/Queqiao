import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const adr=readFileSync("docs/adr/0016-gate3-provider-provenance.md","utf8");
describe("Issue #124 G3.3 L3 architecture gate",()=>{
 it("records approved custom-MCP route without equating native-App evidence",()=>{
  expect(adr).toContain("Status: Accepted — Route B approved by project owner on 2026-10-14");
  expect(adr).toContain("Route A — Native GitHub App");
  expect(adr).toContain("Route B — Queqiao custom MCP");
  expect(adr).toContain("must NOT satisfy native GitHub App L3");
 });
 it("pins actual hosted UI evidence and refuses silent pass",()=>{
  expect(adr).toContain("38515396065");
  expect(adr).toContain("L1/L2 PASS");
  expect(adr).toContain("L3 NOT PROVED");
  expect(adr).toContain("Selected B: Queqiao custom MCP");
 });
 it("documents actual audit implementation gaps and sensitive-data policy",()=>{
  expect(adr).toContain("packages/audit/src/index.ts");
  expect(adr).toContain("apps/gateway/src/mcp-adapter.ts");
  expect(adr).toContain("same-task binding");
  expect(adr).toContain("No session, personal identifiers, credentials or raw conversations");
 });
});
