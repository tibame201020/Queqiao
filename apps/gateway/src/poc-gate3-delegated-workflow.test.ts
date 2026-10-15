import {readFileSync} from 'node:fs';import {parse} from 'yaml';import {describe,it,expect} from 'vitest';
const text=readFileSync('.github/workflows/runtime-provider-browser-controller.yml','utf8');
const y=parse(text) as {on:{workflow_dispatch:{inputs:Record<string,any>}},jobs:Record<string,{if?:string,steps:Array<{name?:string,run?:string,if?:string,env?:Record<string,string>,with?:any}>}>};
describe('#124 combined G3.4/3.5 read-only Hosted-to-ChatGPT content handoff',()=>{
 it('requires fresh main-only explicit delegated opt-in and existing verified G3.3 original audits',()=>{
  expect(y.on.workflow_dispatch.inputs.gate3_delegated_handoff.default).toBe(false);
  expect(text).toContain('G345_DELEGATED_HANDOFF');
  expect(text).toContain('REQUESTED_DELEGATED');
  expect(text).toContain('REQUESTED_AUDIT');
  expect(text).not.toContain('G34_APP_PRIVATE_KEY');expect(text).not.toContain('SIGNAL_NOTES_GATE3_TOKEN');
  expect(y.on).not.toHaveProperty('schedule');
 });
 it('captures only validated routed article then creates handoff only AFTER disposal and independent original Gateway evidence',()=>{
  const steps=y.jobs['phase3-e2e']!.steps;
  const find=(n:string)=>steps.findIndex(s=>s.name===n);
  const source=find('Execute authenticated MCP read of same-Worker G3.2 content'),a=find('Verify independent original Gateway L3 audit evidence');
  const head=find('Verify original Gateway GitHub HEAD audit before lease disposal'),disposed=find('Complete lease and verify provider cancellation');
  const handoff=find('Build exact synthetic ChatGPT delegated handoff after disposed lease');
  const upload=find('Upload only public verified delegated synthetic handoff');
  expect(source).toBeGreaterThan(-1);expect(steps[source]?.run).toContain('QUEQIAO_POC_G345_ORIGINAL_ARTIFACT_PATH');
  expect(source).toBeLessThan(a);expect(a).toBeLessThan(head);expect(head).toBeLessThan(disposed);
  expect(disposed).toBeLessThan(handoff);expect(handoff).toBeLessThan(upload);
  expect(steps[handoff]?.run).toContain('poc-gate3-delegated-handoff-finalize.ts');
  expect(steps[upload]?.with.path).toContain('gate3-delegated-handoff.json');
 });
 it('re-downloads same original proof + two audit artifacts in separate job before validating the handoff',()=>{
  const steps=y.jobs['gate3-audit-recheck']!.steps;
  expect(steps.some(s=>s.run?.includes('poc-gate3-github-artifact.ts'))).toBe(true);
  expect(steps.some(s=>s.run?.includes('poc-gate3-delegated-handoff-recheck.ts'))).toBe(true);
  expect(steps.some(s=>s.with?.name?.includes('gate3-delegated-handoff-'))).toBe(true);
  expect(steps.some(s=>s.with?.name?.includes('gate3-worker-proof-'))).toBe(true);
  expect(text).not.toContain('git push');expect(text).not.toContain('gh pr create');
 });
});
