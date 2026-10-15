import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
const src=readFileSync('packages/browser-harness-runtime/src/native-queqiao-ui-preflight.ts','utf8');
const policy=readFileSync('packages/browser-harness-runtime/src/native-queqiao-preflight.ts','utf8');
const adr=readFileSync('docs/adr/0018-ci-native-chatgpt-runtime-acceptance.md','utf8');
describe('#185 native CI app picker must use the actual registered display name',()=>{
 it('searches the plugin creator-verified exact display name, never an invented shorthand',()=>{
  expect(src).toContain("editor,'@queqiao pc'");
  expect(src).toContain("/^queqiao pc$/i");
  expect(src).not.toContain("editor,'@Queqiao'");
  expect(adr).toContain('displayName=queqiao pc');
  expect(adr).toContain('not the registered display name');
 });
 it('remains read-only and cannot mistake UI presence for a native MCP tool call',()=>{
  expect(policy).toContain('nativeToolCallObserved:false');
  expect(src).not.toMatch(/\.press\(|\.click\(|\.screenshot\(/);
 });
});
