import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
const adr=readFileSync('docs/adr/0017-gate3-chatgpt-delegated-publication.md','utf8');
const ledger=readFileSync('docs/gate3-full-e2e.md','utf8');
const index=readFileSync('docs/adr/README.md','utf8');
describe('#124 ADR-0017 current G3.4 delegated acceptance ledger',()=>{
 it('selects the already-connected GitHub App and preserves G3.3 read-only provider identity',()=>{
  expect(index).toContain('0017-gate3-chatgpt-delegated-publication.md');
  for(const item of ['already connected GitHub App','no additional GitHub App installation','G34_APP_ID','G34_APP_PRIVATE_KEY','Does not supersede: ADR-0016','nativeAppExecution=not_established_by_hash_correlation'])expect(adr).toContain(item);
  const current=ledger.slice(0,ledger.indexOf('## G3.3 read-only capability experiment'));
  expect(current).toContain('CURRENT G3.4/G3.5 CONTRACT (ADR-0017');
  expect(current).toContain('G3.4 | ChatGPT-delegated test publication');
  expect(current).toContain('G3.5 | Full cloud-delegated E2E / PC independence');
  expect(current).toContain('G3.4/G3.5 PASS (ADR-0017 delegated POC)');
  expect(current).not.toContain('Hosted write original Gateway audit NOT PROVED; G3.4 NOT PASSED');
 });
 it('keeps historical independent test evidence and optional autonomous implementation separate',()=>{
  for(const item of ['PR #181','unregistered and default-disabled','38668658061','operator-assisted','No local user PC dependency','Gate 3.4'])expect(adr+ledger).toContain(item);
  expect(adr).toContain('not an unattended GitHub-writing Gateway');
  expect(adr).toContain('does not assert that the ChatGPT-connected GitHub App credential can be used by an Actions runner');
 });
});
