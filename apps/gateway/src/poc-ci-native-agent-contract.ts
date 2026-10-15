/** #185: a data-only *candidate* validator, never a live attestation or a PASS.
 * The true CI-native architecture gate must additionally fetch two real runs'
 * original ChatGPT UI and Gateway/provider evidence independently. */
type Data={ [key:string]:unknown };
const record=(v:unknown):v is Data=>v!==null && typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
function fixedMcpUrl(raw:unknown){
 if(!str(raw))return false;
 try{
  const u=new URL(raw);
  return u.protocol==='https:'&&u.pathname==='/mcp'&&u.username===''&&u.password===''&&
   u.search===''&&u.hash===''&&u.port===''&&u.href===raw&&
   /^[a-z0-9.-]+$/.test(u.hostname)&&u.hostname.includes('.')&&
   !/(^|\.)(localhost|local|internal|testcloud|trycloudflare\.com)$/.test(u.hostname)&&
   !u.hostname.endsWith('.trycloudflare.com')&&!/^(\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)&&
   u.hostname!=='example.com';
 }catch{return false;}
}
export function assessCiNativeAgentRuns(runs:readonly unknown[]){
 const problems=new Set<string>();
 if(runs.length!==2||!runs.every(record)){
  return {status:'NOT_VERIFIED' as const,candidate:'rejected' as const,reasons:['TWO_INDEPENDENT_RUNS_REQUIRED']};
 }
 const [a,b]=runs as Data[];
 if(!fixedMcpUrl(a!.publicMcpUrl)||!fixedMcpUrl(b!.publicMcpUrl)||a!.publicMcpUrl!==b!.publicMcpUrl)
  problems.add('FIXED_ENDPOINT_UNPROVEN');
 for(const r of runs as Data[]){
  const ui=r.ciChatgpt,g=r.gateway,l=r.lease;
  if(!str(r.controllerRunId)||!/^\d+$/.test(r.controllerRunId)||!str(r.workerRunId)||!/^\d+$/.test(r.workerRunId)||
    !record(ui)||ui.observedActor!=='ci_chatgpt_native_ui'||!str(ui.sessionId)||!str(ui.invocationId)||
    ui.toolName!=='queqiao_ci_probe'||ui.endpoint!==r.publicMcpUrl||!hash(ui.requestSha256)||!hash(ui.resultSha256)||
    !time(ui.startedAt)||!time(ui.finishedAt)){
    problems.add('CI_NATIVE_TOOL_ORIGIN_UNPROVEN');
  }
  if(!record(g)||g.origin!=='original_gateway_mcp_event'||!str(g.invocationId)||
   g.endpoint!==r.publicMcpUrl||!record(ui)||g.sessionId!==ui.sessionId||g.workerRunId!==r.workerRunId||!str(g.runtimeId)||!hash(g.requestSha256)||!hash(g.resultSha256)||
   !time(g.receivedAt)||!time(g.returnedAt)||g.invocationId!==ui.invocationId||
   g.requestSha256!==ui.requestSha256||g.resultSha256!==ui.resultSha256)
   problems.add('SAME_INVOCATION_GATEWAY_PROOF_MISSING');
  if(!record(l)||!str(l.leaseId)||l.workerRunId!==r.workerRunId||l.state!=='disposed'||
   !hash(l.workerResultSha256)||!record(g)||l.workerResultSha256!==g.resultSha256||!time(l.requestedAt)||!time(l.readyAt)||!time(l.workerResultAt)||!time(l.disposedAt)||
   !record(ui)||!record(g)||!time(ui.startedAt)||!time(g.receivedAt)||!time(g.returnedAt)||!time(ui.finishedAt)||
   !(ui.startedAt<=g.receivedAt&&g.receivedAt<=l.requestedAt&&l.requestedAt<l.readyAt&&
    l.readyAt<l.workerResultAt&&l.workerResultAt<=g.returnedAt&&g.returnedAt<=ui.finishedAt&&ui.finishedAt<l.disposedAt))
   problems.add('ON_DEMAND_LEASE_AND_DISPOSAL_UNPROVEN');
 }
 if(a!.controllerRunId===b!.controllerRunId||a!.workerRunId===b!.workerRunId||
   (record(a!.lease)&&record(b!.lease)&&a!.lease.leaseId===b!.lease.leaseId)||
   (record(a!.gateway)&&record(b!.gateway)&&a!.gateway.runtimeId===b!.gateway.runtimeId)||
   (record(a!.ciChatgpt)&&record(b!.ciChatgpt)&&
    (a!.ciChatgpt.sessionId===b!.ciChatgpt.sessionId||a!.ciChatgpt.invocationId===b!.ciChatgpt.invocationId)))
   problems.add('RUNTIME_OR_CHAT_SESSION_REUSED');
 return problems.size?{status:'NOT_VERIFIED' as const,candidate:'rejected' as const,reasons:[...problems]}:
  {status:'NOT_VERIFIED' as const,candidate:'eligible_for_independent_provider_readback' as const,reasons:['ORIGINAL_PROVIDER_EVIDENCE_NOT_CHECKED']};
}
