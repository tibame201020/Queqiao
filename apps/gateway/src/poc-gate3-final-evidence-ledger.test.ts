import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const document=readFileSync('docs/gate3-full-e2e.md','utf8');
const current=document.slice(0,document.indexOf('## G3.3 read-only capability experiment'));
describe('#124 actual joined G3.4/G3.5 ADR-0017 acceptance ledger',()=>{
 it('reports functional delegated PASS only after original same-Run Worker, native connected App, exact-head target CI',()=>{
  expect(current).toContain('**G3.4/G3.5 PASS (ADR-0017 delegated POC)**');
  expect(current).toContain('38677390566');
  expect(current).toContain('38677426703');
  expect(current).toContain('38678003939');
  expect(current).toContain('d35b7e2bee2502d22823b6912067851d8eeb18ee');
  expect(current).toContain('46dcbc5f7576e9612f7cfe86d2336f6bbf1d0235d433cf683a007ebbc179ec14');
  expect(current).toContain('Draft PR #4');
  expect(current).not.toContain('joined delegated flow NOT PROVED');
 });
 it('preserves provider attribution and excludes extra identity/autonomy/production claims',()=>{
  for(const s of ['No new GitHub App','Gateway read provider','ChatGPT connected GitHub App write provider',
   'does not prove an App action inside the CI runner','no physically powered-off PC assertion','no production 05:00 schedule switch',
   'signal-notes/main remains at `96c05a2434ddb1829cc6be3f8189439cf3a71ce7`'])expect(current).toContain(s);
 });
});
