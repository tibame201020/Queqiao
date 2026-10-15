import {readFileSync} from 'node:fs';import {describe,it,expect} from 'vitest';
const w=readFileSync('.github/workflows/browser-harness-gate3.yml','utf8');
const s=readFileSync('packages/browser-harness-runtime/src/session-acceptance.ts','utf8');
const source=readFileSync('packages/browser-harness-runtime/src/native-queqiao-ui-preflight.ts','utf8');
const doc=readFileSync('docs/adr/0018-ci-native-chatgpt-runtime-acceptance.md','utf8');
describe('#185 manual CI-only read-only native Queqiao preflight',()=>{
 it('requires exclusive opt-in on reviewed main; PR tests never restore secrets or send browser request',()=>{
  expect(w).toContain('native_mcp_preflight:');expect(w).toMatch(/native_mcp_preflight:\s*\r?\n\s*description:.*\r?\n\s*type: boolean\s*\r?\n\s*default: false/);
  expect(w).toContain('inputs.gate3 || inputs.native_mcp_preflight');
  expect(w).toContain('GATE3_AND_NATIVE_PREFLIGHT_CONFLICT');
  expect(w).not.toContain('gh pr create');expect(w).not.toContain('git push');
  expect(w).not.toMatch(/^\s*schedule:/m);
 });
 it('leaves current Gate 3 unchanged and publishes only bounded receipt with no UI content, profile or URL',()=>{
  expect(s).toContain('CHATGPT_BROWSER_NATIVE_MCP_PREFLIGHT');
  expect(s).toContain('runNativeQueqiaoPreflight(page,sessionEvidence.sessionConfirmed===true)');
  expect(w).toContain('native-mcp-preflight.json');
  expect(w).toContain('if-no-files-found: ignore');
  expect(w).not.toContain('CHATGPT_BROWSER_SESSION_CAPSULE_PART_1: ${{ env.');
  expect(source).not.toMatch(/\.press\(|\.click\(|\.screenshot\(|page\.route\(/);
  expect(source).toContain("observeOne(page,editor,'@queqiao pc'");
  expect(source).toContain("observeOne(page,editor,'@GitHub'");
  expect(source).toContain("controlCandidate");
  expect(doc).toContain('Slice B read-only product discovery');
  expect(doc).toContain('gatePassed=false');
  expect(doc).toContain('Run 38686156534');
  expect(doc).toContain('26ec2533043baaa6c26b69c655ebdd382454d4508d097306b203a2e53dd4d936');
 });
});
