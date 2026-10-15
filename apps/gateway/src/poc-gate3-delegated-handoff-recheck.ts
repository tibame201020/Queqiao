import {readFileSync} from 'node:fs';
import {verifyHostedGithubArchive} from './poc-gate3-github-archive.js';
import {verifyGate3DelegatedHandoff} from './poc-gate3-delegated-handoff.js';
const v=process.env;
const needed=['G345_HANDOFF_PATH','G345_COMPLETION_PATH','G345_WORKER_AUDIT_PATH','G345_HEAD_AUDIT_PATH'] as const;
if(needed.some(k=>!v[k]))throw Error('G345_ARCHIVE_INPUT_MISSING');
const read=(k:typeof needed[number])=>{try{return readFileSync(v[k]!,'utf8');}catch{throw Error('G345_ARCHIVE_SOURCE_MISSING');}};
const expected={controllerRunId:v.GITHUB_RUN_ID??'',controllerAttempt:v.GITHUB_RUN_ATTEMPT??'',workerRunId:'',workerAttempt:'1' as const,
 date:'',sourceRevision:v.GITHUB_SHA??''};
const workerRaw=read('G345_WORKER_AUDIT_PATH'),githubRaw=read('G345_HEAD_AUDIT_PATH');
let handoff:unknown,complete:unknown;
try{handoff=JSON.parse(read('G345_HANDOFF_PATH'));complete=JSON.parse(read('G345_COMPLETION_PATH'));}catch{throw Error('G345_ARCHIVE_INVALID');}
if(!handoff||typeof handoff!=='object'||Array.isArray(handoff))throw Error('G345_ARCHIVE_INVALID');
const r=handoff as {workerRunId?:unknown,date?:unknown};
expected.workerRunId=String(r.workerRunId??'');expected.date=String(r.date??'');
verifyHostedGithubArchive(workerRaw,githubRaw,expected);
const checked=verifyGate3DelegatedHandoff(handoff,complete,workerRaw,githubRaw,expected);
console.log(JSON.stringify({schema:'queqiao.gate3.delegated-handoff-recheck.v1',controllerRunId:checked.controllerRunId,
 workerRunId:checked.workerRunId,date:checked.date,articleSha256:checked.articleSha256,
 archiveMatched:true,leaseState:checked.leaseState,publication:checked.publication,fullGatePassed:false}));
