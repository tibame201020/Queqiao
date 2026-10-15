import {readFileSync,writeFileSync} from 'node:fs';
import {prepareGate3DelegatedHandoff} from './poc-gate3-delegated-handoff.js';
const v=process.env;
const paths=['G345_ORIGINAL_ARTIFACT_PATH','G345_COMPLETION_PATH','G345_WORKER_AUDIT_PATH','G345_HEAD_AUDIT_PATH','G345_HANDOFF_PATH'] as const;
if(paths.some(k=>!v[k]))throw Error('G345_HANDOFF_INPUT_MISSING');
const read=(key:typeof paths[number])=>{try{return readFileSync(v[key]!,'utf8');}catch{throw Error('G345_HANDOFF_SOURCE_MISSING');}};
let source:unknown,complete:unknown;
try{source=JSON.parse(read('G345_ORIGINAL_ARTIFACT_PATH'));complete=JSON.parse(read('G345_COMPLETION_PATH'));}catch{throw Error('G345_HANDOFF_SOURCE_INVALID');}
const originalWorker=read('G345_WORKER_AUDIT_PATH'), originalGithub=read('G345_HEAD_AUDIT_PATH');
const expected={controllerRunId:v.GITHUB_RUN_ID??'',controllerAttempt:v.GITHUB_RUN_ATTEMPT??'',workerRunId:v.G3_EXPECTED_WORKER_RUN_ID??'',
 workerAttempt:'1' as const,date:v.G3_DATE??'',sourceRevision:v.GITHUB_SHA??''};
const handoff=prepareGate3DelegatedHandoff(source,complete,originalWorker,originalGithub,expected);
writeFileSync(v.G345_HANDOFF_PATH!,JSON.stringify(handoff)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
console.log(JSON.stringify({schema:handoff.schema,controllerRunId:handoff.controllerRunId,workerRunId:handoff.workerRunId,date:handoff.date,
 articleSha256:handoff.articleSha256,leaseState:handoff.leaseState,publication:handoff.publication}));
