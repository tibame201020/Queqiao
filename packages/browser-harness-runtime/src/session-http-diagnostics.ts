import type { BrowserSessionCookie } from "./session-capsule.js";

export type NavigationRequest={ redirectedFrom():NavigationRequest|null };
export type NavigationResponse={ url():string;status():number;request():NavigationRequest };
export type NavigationSummary={
  outcome:"response"|"no_response"|"navigation_error";
  status:number|null;
  redirects:number;
  destination:"chatgpt"|"auth"|"other"|"unknown";
};

export function failedNavigation():NavigationSummary{
  return {outcome:"navigation_error",status:null,redirects:0,destination:"unknown"};
}
export function summarizeNavigation(response:NavigationResponse|null):NavigationSummary{
  if(!response)return {outcome:"no_response",status:null,redirects:0,destination:"unknown"};
  let destination:NavigationSummary["destination"]="unknown";
  try{
    const url=new URL(response.url());
    destination=url.hostname==="chatgpt.com"?"chatgpt":
      url.hostname==="auth.openai.com"?"auth":"other";
  }catch{destination="unknown";}
  let redirects=0;
  let request=response.request().redirectedFrom();
  const visited=new Set<NavigationRequest>();
  while(request && redirects<20 && !visited.has(request)){
    visited.add(request);
    redirects++;
    request=request.redirectedFrom();
  }
  return {outcome:"response",status:response.status(),redirects,destination};
}
export type HttpSummary={
 total:number;success:number;redirect:number;unauthorized:number;
 forbidden:number;rateLimited:number;other4xx:number;serverError:number;other:number;
};
export function createHttpDiagnostics(){
 const counts:HttpSummary={total:0,success:0,redirect:0,unauthorized:0,
   forbidden:0,rateLimited:0,other4xx:0,serverError:0,other:0};
 return {
  observe(url:string,status:number):void{
    let host="";
    try{host=new URL(url).hostname.toLowerCase();}catch{return;}
    if(host!=="chatgpt.com" && host!=="auth.openai.com")return;
    counts.total++;
    if(status>=200 && status<300)counts.success++;
    else if(status>=300 && status<400)counts.redirect++;
    else if(status===401)counts.unauthorized++;
    else if(status===403)counts.forbidden++;
    else if(status===429)counts.rateLimited++;
    else if(status>=400 && status<500)counts.other4xx++;
    else if(status>=500 && status<600)counts.serverError++;
    else counts.other++;
  },
  snapshot():HttpSummary{return {...counts};},
 };
}
export function summarizeCookieExpiry(cookies:readonly BrowserSessionCookie[],nowMs:number){
 const now=nowMs/1000;
 const result={source:cookies.length,session:0,expired:0,within24h:0,within7d:0,beyond7d:0};
 for(const cookie of cookies){
  const expiry=cookie.expires;
  if(expiry<=0){result.session++;continue;}
  const remaining=expiry-now;
  if(remaining<=0)result.expired++;
  else if(remaining<=86400)result.within24h++;
  else if(remaining<=7*86400)result.within7d++;
  else result.beyond7d++;
 }
 return result;
}
