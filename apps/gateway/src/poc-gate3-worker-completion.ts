type Observed={controllerRunId:string;controllerAttempt:string;workerRunId:string;
 environmentId:string;leaseId:string;date:string;leaseState:string;workerConclusion:string};
const ID=/^[1-9]\d{0,19}$/,ATTEMPT=/^[1-9]\d{0,7}$/,SHA=/^[a-f0-9]{64}$/;
export function completeGate3WorkerEvidence(raw:unknown,observed:Observed){
 const fail=():never=>{throw Error("G3_CONTROLLER_COMPLETION_INVALID");};
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();
 const p=raw as Record<string,unknown>;
 if(Object.keys(p).sort().join(",")!=="articleSha256,contentVerified,controllerAttempt,controllerRunId,date,logicalKey,path,schema,taskId,workerRunId")return fail();
 const {controllerRunId,controllerAttempt,workerRunId,environmentId,leaseId,date,leaseState,workerConclusion}=observed;
 if(!ID.test(controllerRunId)||!ATTEMPT.test(controllerAttempt)||!ID.test(workerRunId)||
    !/^gha_[a-z0-9_]{4,64}$/.test(environmentId)||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(leaseId)||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)||leaseState!=="disposed"||
    workerConclusion!=="cancelled"||p["schema"]!=="queqiao.gate3.worker-content.v1"||
    p["controllerRunId"]!==controllerRunId||p["controllerAttempt"]!==controllerAttempt||
    p["workerRunId"]!==workerRunId||p["date"]!==date||
    p["taskId"]!==`gate3-${workerRunId}-1`||
    p["logicalKey"]!==`gate3/synthetic-${date}`||
    p["path"]!==`src/content/posts/gate3-synthetic-${date}/index.md`||
    typeof p["articleSha256"]!=="string"||!SHA.test(p["articleSha256"])||
    p["contentVerified"]!==true)return fail();
 return {schema:"queqiao.gate3.controller-complete.v1",controllerRunId,controllerAttempt,workerRunId,
  environmentId,leaseId,date,leaseState:"disposed" as const,workerConclusion:"cancelled" as const,
  taskId:p["taskId"] as string,logicalKey:p["logicalKey"] as string,
  path:p["path"] as string,articleSha256:p["articleSha256"] as string,
  contentVerified:true as const,connector:"not_observed" as const,targetCi:"not_observed" as const};
}
