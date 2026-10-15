import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {assessCiNativeAgentRuns} from './poc-ci-native-agent-contract.js';
const sha='a'.repeat(64);
const evidence=(n:number)=>({
 controllerRunId:String(n),workerRunId:String(n+1000),publicMcpUrl:'https://mcp.example.test/mcp',
 ciStart:{trigger:'workflow_dispatch',startedAt:1,browserSessionReadyAt:5,mcpIngressReadyAt:7},
 ciChatgpt:{sessionId:`ci-${n}`,observedActor:'ci_chatgpt_native_ui',invocationId:`native-${n}`,toolName:'queqiao_ci_probe',endpoint:'https://mcp.example.test/mcp',requestSha256:sha,resultSha256:sha,startedAt:10,finishedAt:90},
 gateway:{sessionId:`ci-${n}`,runtimeId:`gateway-${n}`,workerRunId:String(n+1000),invocationId:`native-${n}`,origin:'original_gateway_mcp_event',endpoint:'https://mcp.example.test/mcp',requestSha256:sha,resultSha256:sha,receivedAt:20,returnedAt:80},
 lease:{leaseId:`lease-${n}`,workerRunId:String(n+1000),workerResultSha256:sha,requestedAt:30,readyAt:40,workerResultAt:70,disposedAt:100,state:'disposed'},
});
describe('#185 CI-first primary topology, no permanent offline webhook as a precondition',()=>{
 it('keeps original CI-first user intent authoritative in ADR and Gate 3 ledger',()=>{
  const adr=readFileSync('docs/adr/0018-ci-native-chatgpt-runtime-acceptance.md','utf8');
  const ledger=readFileSync('docs/gate3-full-e2e.md','utf8');
  expect(adr).toContain('CI-first is the required topology');
  expect(adr).toContain('NOT a prerequisite for #185 CI-first PASS');
  expect(adr).toContain('pre-provisioning the Worker Lease before original model demand is not');
  expect(ledger).toContain('CI-first acceptance clarification (#185)');
 });
 it('allows prior CI-started browser + named ingress to precede model intent; worker lease still follows original model call',()=>{
  expect(assessCiNativeAgentRuns([evidence(123),evidence(124)])).toEqual({
   status:'NOT_VERIFIED',candidate:'eligible_for_independent_provider_readback',reasons:['ORIGINAL_PROVIDER_EVIDENCE_NOT_CHECKED']});
 });
 it('rejects a supposed CI-first run with unproven CI origin or a browser/ingress established after model intent',()=>{
  const cases=[
   (r:ReturnType<typeof evidence>)=>{r.ciStart.trigger='external_controller_script';},
   (r:ReturnType<typeof evidence>)=>{r.ciStart.startedAt=19;},
   (r:ReturnType<typeof evidence>)=>{r.ciStart.browserSessionReadyAt=11;},
   (r:ReturnType<typeof evidence>)=>{r.ciStart.mcpIngressReadyAt=11;},
  ];
  for(const change of cases){const a=evidence(123),b=evidence(124);change(b);
   const verdict=assessCiNativeAgentRuns([a,b]);expect(verdict.candidate).toBe('rejected');
   expect(verdict.reasons).toContain('CI_FIRST_ORIGIN_OR_ORDER_UNPROVEN');
  }
 });
});
