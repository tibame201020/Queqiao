import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {publishGate3RestrictedDraft} from './poc-gate3-draft-provider.js';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const base='a'.repeat(40), commit='b'.repeat(40), blob='c'.repeat(40);
const article='---\ndraft: true\n---\n\nSynthetic TDD fixture';
const plan={schema:'queqiao.gate3.draft-plan.v1',sourceRepository:'tibame201020/Queqiao',targetRepository:'tibame201020/signal-notes',baseBranch:'main',branch:'gate3/synthetic-2026-10-16',taskId:'gate3-1234-1',logicalKey:'gate3/synthetic-2026-10-16',path:'src/content/posts/gate3-synthetic-2026-10-16/index.md',articleSha256:sha(article),article,draft:true,mainWriteAllowed:false,productionScheduleAllowed:false,publicationState:'preflight_only'} as const;
const ok=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
const endpoint=(url:string)=>new URL(url);
const fixture=()=>{const calls:Array<{method:string;url:string;body:any;headers:Headers}>=[];let failAt='';const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const u=endpoint(String(input)),method=init?.method||'GET',body=init?.body?JSON.parse(String(init.body)):null;
 calls.push({method,url:String(input),body,headers:new Headers(init?.headers)});
 const key=method+' '+u.pathname;
 if(key===failAt)throw Error('connection lost after potential execution');
 if(u.hostname!=='api.github.com')throw Error('unexpected host');
 if(key==='GET /installation/repositories')return ok({total_count:1,repositories:[{full_name:'tibame201020/signal-notes'}]});
 if(key==='GET /repos/tibame201020/signal-notes/branches/main')return ok({commit:{sha:base}});
 if(key==='GET /repos/tibame201020/signal-notes/git/matching-refs/heads/gate3/synthetic-2026-10-16')return ok([]);
 if(key==='GET /repos/tibame201020/signal-notes/pulls'&&u.searchParams.get('state')==='all')return ok([]);
 if(key==='POST /repos/tibame201020/signal-notes/git/refs')return ok({ref:'refs/heads/'+plan.branch,object:{sha:base}},201);
 if(key==='PUT /repos/tibame201020/signal-notes/contents/'+plan.path)return ok({commit:{sha:commit},content:{sha:blob,path:plan.path}},201);
 if(key==='GET /repos/tibame201020/signal-notes/branches/gate3/synthetic-2026-10-16')return ok({commit:{sha:commit}});
 if(key==='GET /repos/tibame201020/signal-notes/contents/'+plan.path)return ok({sha:blob,path:plan.path,content:Buffer.from(article).toString('base64')});
 if(key==='GET /repos/tibame201020/signal-notes/commits/'+commit)return ok({sha:commit,parents:[{sha:base}],files:[{filename:plan.path,status:'added'}]});
 if(key==='POST /repos/tibame201020/signal-notes/pulls')return ok({number:12,state:'open',draft:true,head:{ref:plan.branch,sha:commit},base:{ref:'main'},changed_files:1},201);
 if(key==='GET /repos/tibame201020/signal-notes/pulls/12')return ok({number:12,state:'open',draft:true,head:{ref:plan.branch,sha:commit},base:{ref:'main'},changed_files:1});
 if(key==='GET /repos/tibame201020/signal-notes/pulls/12/files')return ok([{filename:plan.path,status:'added'}]);
 throw Error('unexpected '+key);
 });return {fetcher,calls,fail:(v:string)=>{failAt=v;}};};
const run=(f:ReturnType<typeof fixture>,patch?:any)=>publishGate3RestrictedDraft({...plan,...patch}, {token:'test-token-not-real',fetchImpl:f.fetcher as typeof fetch});
describe('#124 G3.4 target-scoped REST writer, no actual network',()=>{
 it('requires verified one-target installation, atomically creates one ref/file and Draft PR; returns pending CI, not PASS',async()=>{
  const f=fixture();const result=await run(f);
  expect(result).toEqual({schema:'queqiao.gate3.draft-submission.v1',repository:plan.targetRepository,branch:plan.branch,baseSha:base,headSha:commit,blobSha:blob,articleSha256:plan.articleSha256,prNumber:12,state:'submitted_pending_target_ci',hostedGatePassed:false});
  expect(f.calls.map(x=>x.method+' '+endpoint(x.url).pathname)).toEqual([
   'GET /installation/repositories','GET /repos/tibame201020/signal-notes/branches/main',
   'GET /repos/tibame201020/signal-notes/git/matching-refs/heads/gate3/synthetic-2026-10-16',
   'GET /repos/tibame201020/signal-notes/pulls','POST /repos/tibame201020/signal-notes/git/refs',
   'PUT /repos/tibame201020/signal-notes/contents/'+plan.path,
   'GET /repos/tibame201020/signal-notes/branches/gate3/synthetic-2026-10-16',
   'GET /repos/tibame201020/signal-notes/contents/'+plan.path,'GET /repos/tibame201020/signal-notes/commits/'+commit,
   'POST /repos/tibame201020/signal-notes/pulls','GET /repos/tibame201020/signal-notes/pulls/12','GET /repos/tibame201020/signal-notes/pulls/12/files']);
  expect(f.calls[4]?.body).toEqual({ref:'refs/heads/'+plan.branch,sha:base});
  expect(f.calls[5]?.body.sha).toBeUndefined();expect(f.calls[5]?.body.branch).toBe(plan.branch);
  expect(f.calls[9]?.body).toMatchObject({head:plan.branch,base:'main',draft:true,maintainer_can_modify:false});
  expect(f.calls.every(c=>c.headers.get('authorization')==='Bearer test-token-not-real')).toBe(true);
  expect(f.calls.every(c=>c.headers.get('accept')==='application/vnd.github+json')).toBe(true);
 });
 it('denies altered target/path/branch/draft/sha/secret before network',async()=>{
  for(const patch of [{targetRepository:'tibame201020/Queqiao'},{branch:'main'},{branch:'gate3/synthetic-2026-10-15'},
   {path:'README.md'},{draft:false},{mainWriteAllowed:true},{articleSha256:'0'.repeat(64)},{article:'private'}]){
   const f=fixture();await expect(run(f,patch)).rejects.toThrow();expect(f.calls).toHaveLength(0);
  }
  const f=fixture();await expect(publishGate3RestrictedDraft(plan,{token:'',fetchImpl:f.fetcher as typeof fetch})).rejects.toThrow();expect(f.calls).toHaveLength(0);
 });
 it('stops when token reaches multiple repositories, branch is already claimed, or any historical PR exists',async()=>{
  for(const mutate of [(u:URL)=>u.pathname==='/installation/repositories'?ok({total_count:2,repositories:[{full_name:plan.targetRepository},{full_name:'else/other'}]}):undefined,
   (u:URL)=>u.pathname.endsWith('/git/matching-refs/heads/'+plan.branch)?ok([{ref:'refs/heads/'+plan.branch}]):undefined,
   (u:URL)=>u.pathname.endsWith('/pulls')?ok([{number:3,state:'closed',head:{ref:plan.branch}}]):undefined]){
    const f=fixture();const original=f.fetcher.getMockImplementation()!;f.fetcher.mockImplementation(async(input,init)=>mutate(endpoint(String(input)))??original(input,init));
    await expect(run(f)).rejects.toThrow();expect(f.calls.some(c=>c.method==='POST'||c.method==='PUT')).toBe(false);
  }
 });
 it('never retries or claims success on uncertain atomic ref/file or PR submission',async()=>{
  for(const key of ['POST /repos/tibame201020/signal-notes/git/refs','PUT /repos/tibame201020/signal-notes/contents/'+plan.path,'POST /repos/tibame201020/signal-notes/pulls']){
   const f=fixture();f.fail(key);await expect(run(f)).rejects.toThrow();expect(f.calls.filter(x=>x.method+' '+endpoint(x.url).pathname===key)).toHaveLength(1);
   expect(f.calls.at(-1)!.method+' '+endpoint(f.calls.at(-1)!.url).pathname).toBe(key);
  }
 });
});
