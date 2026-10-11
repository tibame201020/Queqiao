import type { BrowserSessionCookie, BrowserSessionOrigin } from "./session-capsule.js";

type ObservedCookie = Pick<BrowserSessionCookie,"name"|"value"|"domain"|"path">;
export type CookieRestoreSummary={
 source:number;eligible:number;expired:number;matched:number;missing:number;changed:number;
};
export type StorageRestoreSummary={
 expected:number;observed:number;matched:number;status:"observed"|"not_observed";
};

/** Compare credentials in memory only. Return aggregate counts, never keys,
 * cookie values, storage names, or other bearer-equivalent information.
 */
export function summarizeCookieRestore(
  source:readonly BrowserSessionCookie[],
  observed:readonly ObservedCookie[],
  nowMs:number,
):CookieRestoreSummary {
  const nowSeconds=nowMs/1000;
  const key=(c:ObservedCookie)=>[c.domain.replace(/^\./,"").toLowerCase(),c.path,c.name].join("\u0000");
  const available=new Map(observed.map(c=>[key(c),c.value]));
  const summary:CookieRestoreSummary={source:source.length,eligible:0,expired:0,matched:0,missing:0,changed:0};
  for(const cookie of source){
    if(cookie.expires>0 && cookie.expires<=nowSeconds){summary.expired++;continue;}
    summary.eligible++;
    const id=key(cookie);
    if(!available.has(id)){summary.missing++;continue;}
    if(available.get(id)===cookie.value){summary.matched++;continue;}
    summary.changed++;
  }
  return summary;
}

export function summarizeStorageRestore(
  source:readonly BrowserSessionOrigin[],
  observed:readonly BrowserSessionOrigin[],
):StorageRestoreSummary{
  const expectedOrigin=source.find(x=>x.origin==="https://chatgpt.com");
  const actualOrigin=observed.find(x=>x.origin==="https://chatgpt.com");
  const expected=expectedOrigin?.localStorage??[];
  const actual=actualOrigin?.localStorage??[];
  const actualMap=new Map(actual.map(x=>[x.name,x.value]));
  return {
    expected:expected.length,observed:actual.length,
    matched:expected.filter(x=>actualMap.get(x.name)===x.value).length,
    status:actualOrigin?"observed":"not_observed",
  };
}
