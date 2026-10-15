import {describe,expect,it} from 'vitest';
import {assessCiNativeAgentRuns} from './poc-ci-native-agent-contract.js';
const sha='a'.repeat(64);
const run=(n:number)=>({
 controllerRunId:String(n),workerRunId:String(n+1000),publicMcpUrl:'https://mcp.example.test/mcp',
 ciStart:{trigger:'workflow_dispatch',startedAt:1,browserSessionReadyAt:5,mcpIngressReadyAt:7},
 ciChatgpt:{sessionId:`ci-session-${n}`,observedActor:'ci_chatgpt_native_ui' as string,
  invocationId:`native-${n}`,toolName:'queqiao_ci_probe',endpoint:'https://mcp.example.test/mcp',
  requestSha256:sha,resultSha256:sha,startedAt:10,finishedAt:90},
 gateway:{sessionId:`ci-session-${n}`,runtimeId:`gateway-${n}`,workerRunId:String(n+1000),invocationId:`native-${n}`,origin:'original_gateway_mcp_event' as string,
  endpoint:'https://mcp.example.test/mcp',requestSha256:sha,resultSha256:sha,receivedAt:20,returnedAt:80},
 lease:{leaseId:`lease-${n}`,workerRunId:String(n+1000),workerResultSha256:sha,requestedAt:30,readyAt:40,workerResultAt:70,disposedAt:100,state:'disposed' as string},
});
describe('#185 CI-native ChatGPT architecture evidence boundary',()=>{
 it('rejects original G3.4 controller-script client and quick-tunnel even with real content/CI',()=>{
  const a=run(123),b=run(124);
  a.publicMcpUrl='https://random.trycloudflare.com/mcp';
  a.ciChatgpt.observedActor='controller_test_script';
  const verdict=assessCiNativeAgentRuns([a,b]);
  expect(verdict.status).toBe('NOT_VERIFIED');
  expect(verdict.candidate).toBe('rejected');
  expect(verdict.reasons).toContain('FIXED_ENDPOINT_UNPROVEN');
  expect(verdict.reasons).toContain('CI_NATIVE_TOOL_ORIGIN_UNPROVEN');
 });
 it('treats two consistent fixture runs as a CANDIDATE only, never live PASS',()=>{
  expect(assessCiNativeAgentRuns([run(123),run(124)])).toEqual({
   status:'NOT_VERIFIED',candidate:'eligible_for_independent_provider_readback',reasons:['ORIGINAL_PROVIDER_EVIDENCE_NOT_CHECKED'],
  });
 });
 it('fails closed on wrong session/proxy, pre-provisioned lease, stale worker, missing disposal or same reused runtime',()=>{
  type RunFixture=ReturnType<typeof run>;
  const replacements:Array<(a:RunFixture,b:RunFixture)=>void>=[
   (a,b)=>{b.publicMcpUrl='https://other.example.test/mcp';},
   (a,b)=>{b.ciChatgpt.endpoint='https://other.example.test/mcp';},
   (a,b)=>{b.gateway.invocationId='controller-script-id';},
   (a,b)=>{b.gateway.sessionId='external-session';},
   (a,b)=>{b.gateway.workerRunId='999';},
   (a,b)=>{b.lease.workerResultSha256='f'.repeat(64);},
   (a,b)=>{b.gateway.runtimeId=a.gateway.runtimeId;},
   (a,b)=>{b.lease.requestedAt=1;},
   (a,b)=>{b.lease.state='running';},
   (a,b)=>{b.lease.disposedAt=0;},
   (a,b)=>{b.lease.leaseId=a.lease.leaseId;},
   (a,b)=>{b.workerRunId=a.workerRunId;b.lease.workerRunId=a.workerRunId;},
   (a,b)=>{b.ciChatgpt.observedActor='external_chatgpt_conversation';},
  ];
  for(const alter of replacements){const a=run(123),b=run(124);alter(a,b);
   expect(assessCiNativeAgentRuns([a,b]).candidate).toBe('rejected');
  }
 });
});
