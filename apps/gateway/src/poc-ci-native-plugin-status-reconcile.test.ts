import {readFileSync} from 'node:fs';import {describe,expect,it} from 'vitest';
const adr=readFileSync('docs/adr/0018-ci-native-chatgpt-runtime-acceptance.md','utf8');
describe('#185 do not equate cross-API plugin aliases with actual CI Web installation',()=>{
 it('preserves conflicting provider read-only observations instead of asserting uninstallation',()=>{
  expect(adr).toContain('already_installed');
  expect(adr).toContain('not_installed');
  expect(adr).toContain('not a definitive installation verdict');
  expect(adr).toContain('CI Web session');
 });
 it('retains original no-native-tool verdict despite present existing connected App',()=>{
  expect(adr).toContain('38691502119');
  expect(adr).toContain('nativeToolCallObserved=false');
  expect(adr).toContain('NOT ACCEPTED');
 });
});
