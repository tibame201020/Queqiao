import {createHash} from 'node:crypto';
import type {Gate3DraftPlan} from './poc-gate3-draft-contract.js';
import {assessGate3RemoteClaim} from './poc-gate3-draft-contract.js';

const REPO='tibame201020/signal-notes';
const ROOT=`https://api.github.com/repos/${REPO}`;
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=(stage:string):never=>{throw Error('G34_PROVIDER_'+stage);};
const shape=(p:Gate3DraftPlan)=>{
 const match=/^gate3\/synthetic-(\d{4}-\d{2}-\d{2})$/.exec(p.branch);
 if(Object.keys(p).sort().join(',')!==['schema','sourceRepository','targetRepository','baseBranch','branch','taskId','logicalKey','path','articleSha256','article','draft','mainWriteAllowed','productionScheduleAllowed','publicationState'].sort().join(','))return fail('PLAN_INVALID');
 if(!match||Number.isNaN(Date.parse(match[1]!))||new Date(match[1]!).toISOString().slice(0,10)!==match[1]||
  p.schema!=='queqiao.gate3.draft-plan.v1'||p.sourceRepository!=='tibame201020/Queqiao'||
  p.targetRepository!==REPO||p.baseBranch!=='main'||
  p.path!==`src/content/posts/gate3-synthetic-${match[1]}/index.md`||
  !/^gate3-[1-9]\d{0,19}-1$/.test(p.taskId)||p.logicalKey!==`gate3/synthetic-${match[1]}`||
  p.draft!==true||p.mainWriteAllowed!==false||p.productionScheduleAllowed!==false||
  p.publicationState!=='preflight_only'||typeof p.article!=='string'||p.article.length>12000||
  !/^draft: true$/m.test(p.article)||!SHA64.test(p.articleSha256)||hash(p.article)!==p.articleSha256)return fail('PLAN_INVALID');
};
/** Repo-scoped GitHub App installation token is provided only by a trusted controller.
 * No direct MCP exposure or Hosted enablement. This adapter only submits a draft; CI
 * and original Gateway audit must be checked independently before a Gate verdict.
 * On any uncertain write it stops without retry, update, delete or rollback.
 */
export async function publishGate3RestrictedDraft(plan:Gate3DraftPlan,options:{token:string;fetchImpl?:typeof fetch}){
 shape(plan);const token=options.token;
 if(typeof token!=='string'||token.length<1||token.includes('\n')||token.includes('\r'))fail('AUTH_MISSING');
 const fetchImpl=options.fetchImpl??fetch;
 const request=async(method:'GET'|'POST'|'PUT',route:string,body?:object,status=200):Promise<unknown>=>{
  let response:Response;
  try{response=await fetchImpl(route.startsWith('https://')?route:ROOT+route,{
   method,redirect:'error',headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json',
    'x-github-api-version':'2022-11-28','content-type':'application/json','user-agent':'Queqiao-G34-Isolated-Draft'},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),
  });}catch{return fail('UNCERTAIN_NO_RETRY');}
  if(response.status!==status)return fail('PROVIDER_STATUS_UNCONFIRMED');
  try{return await response.json();}catch{return fail('PROVIDER_RESPONSE_INVALID');}
 };
 // Independent inventory of the installation token itself. A source-repo token is not a valid substitute.
 const grants=await request('GET','https://api.github.com/installation/repositories');
 if(!object(grants)||grants.total_count!==1||!Array.isArray(grants.repositories)||
  grants.repositories.length!==1||grants.repositories[0]?.full_name!==REPO)fail('TARGET_TOKEN_SCOPE_INVALID');
 const base=await request('GET','/branches/main');
 const baseSha=object(base)&&object(base.commit)?base.commit.sha:null;
 if(typeof baseSha!=='string'||!SHA40.test(baseSha))fail('BASE_UNCONFIRMED');
 const refsRaw=await request('GET',`/git/matching-refs/heads/${plan.branch}`);
 if(!Array.isArray(refsRaw))fail('REF_INVENTORY_INVALID');
 const refs=refsRaw as unknown[];
 const prsRaw=await request('GET',`/pulls?state=all&head=${encodeURIComponent('tibame201020:'+plan.branch)}&per_page=100`);
 if(!Array.isArray(prsRaw)||prsRaw.length>=100)fail('PR_INVENTORY_INVALID');
 const prs=prsRaw as unknown[];
 const projected=prs.map((p:unknown)=>object(p)&&object(p.head)&&object(p.base)?{
  state:p.state,draft:p.draft,head:p.head.ref,base:p.base.ref}:null);
 if(projected.some((x:unknown)=>x===null))fail('PR_INVENTORY_INVALID');
 const gate=assessGate3RemoteClaim(plan,{branch:refs.length?'present':'absent',pullRequests:projected as any,complete:true});
 if(gate!=='atomic_create_ref_required')fail(gate.toUpperCase());
 const claimed=await request('POST','/git/refs',{ref:`refs/heads/${plan.branch}`,sha:baseSha},201);
 if(!object(claimed)||claimed.ref!==`refs/heads/${plan.branch}`||claimed.object?.sha!==baseSha)fail('ATOMIC_REF_UNCONFIRMED');
 const createdRaw=await request('PUT',`/contents/${plan.path}`,{
  message:`test(content): isolated G3.4 synthetic draft ${plan.branch.slice(-10)}`,
  content:Buffer.from(plan.article,'utf8').toString('base64'),branch:plan.branch,
 },201);
 if(!object(createdRaw))fail('FILE_CREATE_UNCONFIRMED');
 const created=createdRaw as Record<string,any>;
 if(!object(created.commit)||!object(created.content)||
  !SHA40.test(created.commit.sha)||!SHA40.test(created.content.sha)||created.content.path!==plan.path)fail('FILE_CREATE_UNCONFIRMED');
 const commitSha=created.commit.sha as string,blobSha=created.content.sha as string;
 const head=await request('GET',`/branches/${plan.branch}`);
 if(!object(head)||head.commit?.sha!==commitSha)fail('HEAD_READBACK_MISMATCH');
 const fileRaw=await request('GET',`/contents/${plan.path}?ref=${encodeURIComponent(plan.branch)}`);
 if(!object(fileRaw))fail('FILE_READBACK_INVALID');
 const file=fileRaw as Record<string,any>;
 if(file.path!==plan.path||file.sha!==blobSha||typeof file.content!=='string')fail('FILE_READBACK_INVALID');
 let readBytes:Buffer;
 try{readBytes=Buffer.from(file.content.replace(/\s/g,''),'base64');}catch{return fail('FILE_READBACK_INVALID');}
 if(readBytes.toString('base64')!==file.content.replace(/\s/g,'')||hash(readBytes.toString('utf8'))!==plan.articleSha256||
  readBytes.toString('utf8')!==plan.article)fail('FILE_READBACK_MISMATCH');
 const commit=await request('GET',`/commits/${commitSha}`);
 if(!object(commit)||commit.sha!==commitSha||!Array.isArray(commit.parents)||commit.parents.length!==1||
  commit.parents[0]?.sha!==baseSha||!Array.isArray(commit.files)||commit.files.length!==1||
  commit.files[0]?.filename!==plan.path||commit.files[0]?.status!=='added')fail('COMMIT_READBACK_MISMATCH');
 const submittedRaw=await request('POST','/pulls',{
  title:`test(content): G3.4 isolated synthetic draft ${plan.branch.slice(-10)}`,
  body:'Synthetic Gate 3.4 controlled Draft PR. Do not merge or enable production scheduling. Hosted acceptance requires original Gateway audit and independent target CI.',
  head:plan.branch,base:'main',draft:true,maintainer_can_modify:false,
 },201);
 if(!object(submittedRaw))fail('DRAFT_PR_UNCONFIRMED');
 const submitted=submittedRaw as Record<string,any>;
 if(!Number.isSafeInteger(submitted.number)||submitted.number<1||submitted.draft!==true||
  submitted.state!=='open'||submitted.head?.ref!==plan.branch||submitted.head?.sha!==commitSha||
  submitted.base?.ref!=='main'||submitted.changed_files!==1)fail('DRAFT_PR_UNCONFIRMED');
 const pr=await request('GET',`/pulls/${submitted.number}`);
 const files=await request('GET',`/pulls/${submitted.number}/files?per_page=100`);
 if(!object(pr)||pr.number!==submitted.number||pr.state!=='open'||pr.draft!==true||
  pr.head?.ref!==plan.branch||pr.head?.sha!==commitSha||pr.base?.ref!=='main'||pr.changed_files!==1||
  !Array.isArray(files)||files.length!==1||files[0]?.filename!==plan.path||files[0]?.status!=='added')fail('DRAFT_READBACK_MISMATCH');
 return {schema:'queqiao.gate3.draft-submission.v1' as const,repository:REPO,
  branch:plan.branch,baseSha,headSha:commitSha,blobSha,articleSha256:plan.articleSha256,
  prNumber:submitted.number as number,state:'submitted_pending_target_ci' as const,hostedGatePassed:false as const};
}
