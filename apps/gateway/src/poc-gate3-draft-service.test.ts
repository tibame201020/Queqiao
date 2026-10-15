import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createAuditEvent} from '@queqiao/audit';
import {makeGate3Artifact,validateGate3Output} from '@queqiao/browser-harness-runtime/gate3-content';
import {createGate3Trace} from '@queqiao/browser-harness-runtime/gate3-trace';
import {gate3ReadRequestHash} from './poc-gate3-audit-read.js';
import {gate3GithubHeadRequestHash,gate3GithubHeadResultHash} from './poc-gate3-github-head.js';
import {Gate3HostedDraftSubmission} from './poc-gate3-draft-service.js';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const revision='a'.repeat(40), date='2026-10-16';
const b={controllerRunId:'12345678',controllerAttempt:'1',workerRunId:'12345679',workerAttempt:'1',environmentId:'gha_worker_alpha',leaseId:'ee9f4f43-777b-4578-8fce-e7a4de693898',date,repository:'tibame201020/Queqiao'};
const target={controllerRunId:b.controllerRunId,controllerAttempt:'1',date,repository:b.repository,sourceRevision:revision};
const fields=validateGate3Output(JSON.stringify({concept:'測試驅動開發要求先描述預期行為，再以失敗測試確認實作缺口與可驗證標準。',verification:'先讓測試失敗，再完成最小實作使測試通過，最後重構並再次確認回歸測試。',limitation:'這只是隔離的內容產線測試，不是新聞、投資研究或任何正式發表的文章。'}));
function fixture(){
 const content=makeGate3Artifact({runId:b.workerRunId,runAttempt:'1',date,fields,authenticated:true,userTurn:true,assistantTurn:true,generationFinished:true});
 const raw={...content,trace:createGate3Trace(content)};
 const verified={schema:'queqiao.gate3.worker-content.v1',controllerRunId:b.controllerRunId,controllerAttempt:b.controllerAttempt,workerRunId:b.workerRunId,taskId:raw.trace.taskId,logicalKey:raw.trace.logicalKey,articleSha256:raw.trace.articleSha256,date,path:raw.path,contentVerified:true};
 const {date: _excludedDate, ...bound}=b;
 const shared={...bound,taskId:raw.trace.taskId,logicalKey:raw.trace.logicalKey};
 const principal='test-oauth-principal',digest=hash(principal);
 const workerExpected={...shared,action:'read_gate3_artifact',requestSha256:gate3ReadRequestHash(b),resultSha256:hash(JSON.stringify(verified))};
 const headExpected={...shared,action:'read_public_github_head',requestSha256:gate3GithubHeadRequestHash(b,revision),resultSha256:gate3GithubHeadResultHash(revision)};
 const event=(action:string,e:typeof workerExpected)=>createAuditEvent({component:'gateway',category:'tool',action,outcome:'success',subject:{provider:'queqiao_custom_mcp',taskId:e.taskId},detail:{...e,provider:'queqiao_custom_mcp',principalDigest:digest}});
 const wEvent=event('gate3.read_artifact',workerExpected),hEvent=event('gate3.read_public_head',headExpected);
 const receipt=(e:typeof workerExpected,id:string)=>({schema:'queqiao.gate3.connector-execution.v1',provider:'queqiao_custom_mcp',...e,principalDigest:digest,eventId:id,outcome:'success',executionObserved:true});
 const workerReceipt=receipt(workerExpected,wEvent.id),headReceipt=receipt(headExpected,hEvent.id);
 let active=true;let sourceChanged=false;const lease=()=>({providerId:'github-actions',leaseId:b.leaseId,state:active?'ready':'disposed',expiresAt:new Date(Date.now()+600000).toISOString(),worker:{workerId:'worker-alpha',environmentId:b.environmentId},metadata:{taskKind:'gate3-content',gate3Date:date,controllerRunId:b.controllerRunId,controllerRunAttempt:b.controllerAttempt,sourceRevision:sourceChanged?'b'.repeat(40):revision},providerMetadata:{runId:b.workerRunId,environmentId:b.environmentId}});
 const coordinator={list:()=>[lease()]};
 const registry={requireTool:vi.fn(async()=>{}),readFile:vi.fn(async()=>({value:{path:'gate3-artifact.json',startLine:1,endLine:1,totalLines:1,text:JSON.stringify(raw)},routing:{environmentId:b.environmentId}}))};
 let auditBroken=false;const appended:any[]=[];const audit={query:vi.fn(async(o:{action:string})=>({issues:[],events:auditBroken?[]:o.action==='gate3.read_artifact'?[wEvent]:o.action==='gate3.read_public_head'?[hEvent]:[]})),append:vi.fn(async(e:any)=>{appended.push(e);})};
 const publish=vi.fn(async()=>({schema:'queqiao.gate3.draft-submission.v1',repository:'tibame201020/signal-notes',branch:'gate3/synthetic-'+date,baseSha:'f'.repeat(40),headSha:'e'.repeat(40),blobSha:'d'.repeat(40),articleSha256:raw.receipt.articleSha256,prNumber:9,state:'submitted_pending_target_ci',hostedGatePassed:false}));
 const service=new Gate3HostedDraftSubmission({target,binding:b,coordinator,registry,audit,workerReceipt,headReceipt,token:'test-target-token',publish});
 return {service,publish,registry,audit,appended,raw,principal,workerReceipt,headReceipt,dispose:()=>{active=false;},change:()=>{sourceChanged=true;},breakAudit:()=>{auditBroken=true;}};
}
describe('#124 G3.4 same-task Hosted write authority barrier',()=>{
 it('needs two original Gateway events + same principal + exact routed Worker content before recording intent or publishing',async()=>{
  const f=fixture();const r=await f.service.execute(f.principal);
  expect(r.state).toBe('submitted_pending_target_ci');expect(r.hostedGatePassed).toBe(false);
  expect(f.publish).toHaveBeenCalledTimes(1);
  expect(f.appended).toHaveLength(2);expect(f.appended[0].action).toBe('gate3.draft_intent');
  expect(f.appended[1].action).toBe('gate3.draft_submission');
  expect(f.appended[0].detail).not.toHaveProperty('article');
  expect(f.appended[0].detail).not.toHaveProperty('token');
  expect(f.appended[1].detail).not.toHaveProperty('token');
  await expect(f.service.execute(f.principal)).rejects.toThrow('G34_ALREADY_CLAIMED');
 });
 it('refuses different principal, missing original audit, expired/disposed lease and changed revision without provider writes',async()=>{
  const wrong=fixture();await expect(wrong.service.execute('another-principal')).rejects.toThrow();expect(wrong.publish).not.toHaveBeenCalled();
  for(const sabotage of [(f:ReturnType<typeof fixture>)=>f.breakAudit(),(f:ReturnType<typeof fixture>)=>f.dispose(),(f:ReturnType<typeof fixture>)=>f.change()]){
   const f=fixture();sabotage(f);await expect(f.service.execute(f.principal)).rejects.toThrow();expect(f.publish).not.toHaveBeenCalled();
  }
 });
 it('refuses to call any provider when the original intent audit cannot persist',async()=>{
  const f=fixture();f.audit.append.mockRejectedValueOnce(Error('audit storage failure'));
  await expect(f.service.execute(f.principal)).rejects.toThrow();expect(f.publish).not.toHaveBeenCalled();
  await expect(f.service.execute(f.principal)).rejects.toThrow('G34_ALREADY_CLAIMED');
 });
 it('records only sanitized failed outcome if an uncertain REST write fails, without replay',async()=>{
  const f=fixture();f.publish.mockRejectedValueOnce(Error('token/private/provider error'));
  await expect(f.service.execute(f.principal)).rejects.toThrow('G34_SUBMISSION_UNCONFIRMED_NO_RETRY');
  expect(f.publish).toHaveBeenCalledTimes(1);
  expect(f.appended).toHaveLength(2);expect(f.appended[1].action).toBe('gate3.draft_submission');
  expect(f.appended[1].outcome).toBe('failed');
  expect(JSON.stringify(f.appended)).not.toContain('test-target-token');
  expect(JSON.stringify(f.appended)).not.toContain('token/private/provider error');
 });
 it('never publishes a forged or mutated second read, nor retries after a failed provider call',async()=>{
  const f=fixture();f.registry.readFile.mockImplementation(async()=>({value:{path:'gate3-artifact.json',startLine:1,endLine:1,totalLines:1,text:JSON.stringify({...f.raw,article:'PRIVATE'})},routing:{environmentId:b.environmentId}}));
  await expect(f.service.execute(f.principal)).rejects.toThrow();expect(f.publish).not.toHaveBeenCalled();
  const g=fixture();g.publish.mockRejectedValueOnce(Error('uncertain after create-ref'));await expect(g.service.execute(g.principal)).rejects.toThrow();expect(g.publish).toHaveBeenCalledTimes(1);await expect(g.service.execute(g.principal)).rejects.toThrow('G34_ALREADY_CLAIMED');
 });
});
