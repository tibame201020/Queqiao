import { z } from "zod";

type Routed = { isError?:boolean; _meta?:{"dev.queqiao/routing"?:{environmentId?:string}};
  content?:Array<{type?:string;text?:string}> };
function payload(input:unknown,expectedEnv:string):string {
 const r=input as Routed;
 if(!r || typeof r!=="object" || r.isError)throw new Error("MCP tool failed");
 if(r._meta?.["dev.queqiao/routing"]?.environmentId!==expectedEnv)throw new Error("Wrong remote Worker routing receipt");
 const text=r.content?.find(x=>x.type==="text")?.text;
 if(typeof text!=="string")throw new Error("Remote MCP result lacks text");
 return text;
}
export function verifyRemoteBrowserTool(input:unknown,environmentId:string):{routed:true}{
 const result=JSON.parse(payload(input,environmentId)) as Record<string,unknown>;
 if(result["workspaceId"]!=="runtime"||result["executable"]!=="node"||
    result["exitCode"]!==0||result["outputLimitExceeded"]===true||
    typeof result["stdout"]!=="string"||
    !result["stdout"].includes("QUEQIAO_CI_BROWSER_HARNESS_OK")) {
   throw new Error("Remote Worker Browser Harness failed: keys="+Object.keys(result).sort().join(",")+
     " exit="+String(result["exitCode"])+ " timedOut="+String(result["timedOut"])+ " aborted="+String(result["aborted"])+
     " marker="+String(typeof result["stdout"]==="string" && result["stdout"].includes("QUEQIAO_CI_BROWSER_HARNESS_OK"))+
     " failureClass="+(typeof result["stderr"]==="string" ?
       (result["stderr"].includes("ERR_MODULE_NOT_FOUND") ? "module_not_found" :
       result["stderr"].includes("ERR_CERT") ? "tls_error" :
       result["stderr"].includes("net::") ? "navigation_error" :
       result["stderr"].includes("BROWSER_CDP") ? "cdp_unavailable" :
       result["stderr"].includes("EACCES") ? "permission_denied" :
       result["stderr"].includes("Cannot find") ? "missing_dependency" : "other") : "missing_stderr")+
     " stderrLine="+(typeof result["stderr"]==="string" ? result["stderr"].split(/\r?\n/).find(x=>x.trim()&&!x.includes("://"))?.slice(0,220) : ""));
 }
 return {routed:true};
}
export function verifyRemoteBrowserReceipt(input:unknown,environmentId:string,workerRunId:string){
 const text=payload(input,environmentId);
 const matched=/^Workspace: runtime\r?\nPath: ci-browser-receipt\.json\r?\nLines: 1-1 of [1-9]\d*\r?\n\r?\n([^\r\n]+)/.exec(text);
 if(!matched){
  const safeHeader=text.split(/\r?\n/).slice(0,4).map(s=>s.slice(0,130));
  throw new Error("Remote receipt format mismatch: "+JSON.stringify(safeHeader));
 }
 const receipt=z.object({
 runId:z.string().regex(/^[0-9]+$/),origin:z.literal("https://example.com"),
 pageTitle:z.literal("Example Domain"), interactiveMarker:z.literal("QUEQIAO_CI_BROWSER_HARNESS_OK"),
 clicks:z.literal(1),inputEcho:z.literal("CI-only-synthetic-input"),headless:z.literal(true),
}).strict().parse(JSON.parse(matched[1]!));
 if(receipt.runId!==workerRunId)throw new Error("GitHub Actions Worker Run ID mismatch");
 return receipt;
}
