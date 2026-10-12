import { z } from "zod";

const part=z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const runId=z.number().int().positive();
const payload=z.object({
  id:runId,
  repository:z.object({full_name:z.string()}),
  workflow_id:z.number().int().positive(),
  name:z.string(),
  path:z.string(),
  head_branch:z.string(),
  event:z.string(),
  actor:z.object({login:z.string()}),
  display_title:z.string(),
  run_attempt:z.number().int().positive(),
  status:z.string(),
  conclusion:z.string().nullable(),
});

/**
 * Narrow GitHub REST adapter for OIDC-attested recovery only.
 * Cancel response means requested, NOT disposed. Caller must re-GET
 * and confirm terminal state before updating the database.
 */
export class GitHubRecoveryRestApi {
  private readonly base:string;
  private readonly token:string;
  private readonly transport:typeof fetch;
  constructor(config:{token:string;apiBaseUrl?:string;fetchImpl?:typeof fetch}){
    this.token=z.string().min(1).parse(config.token);
    this.base=new URL(config.apiBaseUrl??"https://api.github.com/").href.replace(/\/$/,"");
    this.transport=config.fetchImpl??fetch;
  }
  private url(owner:string,repo:string,id:number):string{
    return this.base+"/repos/"+encodeURIComponent(part.parse(owner))+"/"+
      encodeURIComponent(part.parse(repo))+"/actions/runs/"+runId.parse(id);
  }
  private headers():Record<string,string>{
    return {Accept:"application/vnd.github+json",
      Authorization:"Bearer "+this.token,
      "X-GitHub-Api-Version":"2026-03-10",
      "User-Agent":"queqiao-run-recovery"};
  }
  async get(owner:string,repo:string,id:number){
    const response=await this.transport(this.url(owner,repo,id),{method:"GET",headers:this.headers()});
    if(!response.ok)throw new Error("GitHub run status read failed with HTTP "+response.status);
    const text=await response.text();
    if(text.length>250_000)throw new Error("GitHub run status response exceeds limit");
    const result=payload.parse(JSON.parse(text));
    return {
      id:result.id,repository:result.repository.full_name,
      workflow:result.path.split("/").at(-1)!,path:result.path,
      head_branch:result.head_branch,event:result.event,
      actor:result.actor.login,display_title:result.display_title,
      run_attempt:result.run_attempt,status:result.status,conclusion:result.conclusion,
    };
  }
  async cancel(owner:string,repo:string,id:number):Promise<void>{
    const response=await this.transport(this.url(owner,repo,id)+"/cancel",
      {method:"POST",headers:this.headers()});
    if(!response.ok)throw new Error("GitHub run cancellation request failed with HTTP "+response.status);
  }
}
