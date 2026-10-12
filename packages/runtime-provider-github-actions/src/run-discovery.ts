import { z } from "zod";

const lease=z.string().uuid();
const slug=z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/);
const workflow=z.string().regex(/^[a-zA-Z0-9_.-]+\.ya?ml$/);
const branch=z.string().min(1).max(255).regex(/^[a-zA-Z0-9_./-]+$/);
const actor=z.string().regex(/^[a-zA-Z0-9-]{1,39}$/);
const row=z.object({
 id:z.number().int().positive(),display_title:z.string(),event:z.string(),
 head_branch:z.string().nullable(),path:z.string(),
 actor:z.object({login:z.string()}).nullable(),
 repository:z.object({full_name:z.string()}),
 created_at:z.string().datetime({offset:true}),run_attempt:z.number().int().positive(),
});
const listing=z.object({total_count:z.number().int().nonnegative(),workflow_runs:z.array(row).max(100)});
export type RunListQuery={owner:string;repo:string;workflowId:string;ref:string;from:string;to:string};
export type RunScanInput=RunListQuery & {actor:string;leaseId:string;createdAt:string};
export type RunScanResult={status:"not_found"|"ambiguous"}|{status:"candidate";runId:number};
export function runtimeRunTitle(leaseId:string):string{return "Queqiao Runtime "+lease.parse(leaseId);}
export interface GitHubWorkflowRunReadApi {
 listRuns(query:RunListQuery,page:number):Promise<{total_count:number;workflow_runs:unknown[]}>;
}
export class GitHubWorkflowRunFetchApi implements GitHubWorkflowRunReadApi {
 private token:string;
 private base:string;
 private transport:typeof fetch;
 constructor(config:{token:string;apiBaseUrl?:string;fetchImpl?:typeof fetch}){
  this.token=z.string().min(1).parse(config.token);
  this.base=new URL(config.apiBaseUrl??"https://api.github.com/").href.replace(/\/$/,"");
  this.transport=config.fetchImpl??fetch;
 }
 async listRuns(query:RunListQuery,page:number):Promise<{total_count:number;workflow_runs:unknown[]}>{
  const url=new URL(this.base+"/repos/"+encodeURIComponent(slug.parse(query.owner))+"/"+
   encodeURIComponent(slug.parse(query.repo))+"/actions/workflows/"+
   encodeURIComponent(workflow.parse(query.workflowId))+"/runs");
  url.searchParams.set("event","workflow_dispatch");
  url.searchParams.set("branch",branch.parse(query.ref));
  url.searchParams.set("created",query.from+".."+query.to);
  url.searchParams.set("per_page","100");
  url.searchParams.set("page",String(z.number().int().min(1).max(10).parse(page)));
  const response=await this.transport(url.href,{method:"GET",headers:{
   Accept:"application/vnd.github+json",Authorization:"Bearer "+this.token,
   "X-GitHub-Api-Version":"2026-03-10","User-Agent":"queqiao-runtime-discovery",
  }});
  if(!response.ok)throw new Error("GitHub Actions run listing failed with HTTP "+response.status);
  const body=await response.text();
  if(body.length>4_000_000)throw new Error("GitHub run listing exceeded bounded size");
  return listing.parse(JSON.parse(body));
 }
}
/** Discovery is read-only. display_title can be spoofed, so no automatic
 * cancellation or OIDC trust may follow from a candidate alone.
 */
export class GitHubActionsRunDiscovery {
 constructor(private readonly api:GitHubWorkflowRunReadApi){}
 async inspect(input:Omit<RunScanInput,"from"|"to">):Promise<RunScanResult>{
  const id=lease.parse(input.leaseId);
  const owner=slug.parse(input.owner),repo=slug.parse(input.repo);
  const workflowId=workflow.parse(input.workflowId);
  const ref=branch.parse(input.ref),trustedActor=actor.parse(input.actor);
  const created=Date.parse(z.string().datetime({offset:true}).parse(input.createdAt));
  const from=new Date(created-120_000).toISOString();
  const to=new Date(created+1_200_000).toISOString();
  const query={owner,repo,workflowId,ref,from,to};
  const title=runtimeRunTitle(id);
  const expectedPath=(".github/workflows/"+workflowId).toLowerCase();
  const repoName=(owner+"/"+repo).toLowerCase();
  const matches:number[]=[];
  let total:number|undefined;
  let scanned=0;
  for(let page=1;page<=10;page++){
   const next=listing.parse(await this.api.listRuns(query,page));
   if(total===undefined){
    total=next.total_count;
    if(total>1000)throw new Error("Incomplete run discovery: limit exceeded");
   }
   if(total!==next.total_count)throw new Error("Incomplete run discovery: listing changed");
   if(next.workflow_runs.length===0&&scanned<total)throw new Error("Incomplete run discovery page");
   for(const candidate of next.workflow_runs){
    if(candidate.display_title!==title||candidate.event!=="workflow_dispatch"||
       candidate.head_branch!==ref||candidate.path.split("@")[0]?.toLowerCase()!==expectedPath||
       candidate.repository.full_name.toLowerCase()!==repoName||
       candidate.actor?.login!==trustedActor||
       candidate.run_attempt!==1||
       Date.parse(candidate.created_at)<created-120_000||
       Date.parse(candidate.created_at)>created+1_200_000)continue;
    matches.push(candidate.id);
   }
   scanned+=next.workflow_runs.length;
   if(scanned>=total)break;
   if(page===10)throw new Error("Incomplete run discovery: pagination limit");
  }
  if(matches.length>1)return {status:"ambiguous"};
  if(matches.length===1)return {status:"candidate",runId:matches[0]!};
  return {status:"not_found"};
 }
}
