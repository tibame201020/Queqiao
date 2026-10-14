const SHA=/^[a-f0-9]{64}$/,ID=/^[1-9]\d{0,19}$/,ATT=/^[1-9]\d{0,7}$/;
export type ExpectedCustomMcpExecution={controllerRunId:string;controllerAttempt:string;workerRunId:string;workerAttempt:string;environmentId:string;leaseId:string;taskId:string;logicalKey:string;repository:string;action:string;requestSha256:string;resultSha256:string};
export type CustomMcpReceiptVerdict="invalid_receipt"|"receipt_mismatch"|"witness_missing"|"witness_untrusted"|"witness_mismatch"|"candidate_for_independent_review";
const receiptKeys=["schema","provider","controllerRunId","controllerAttempt","workerRunId","workerAttempt","environmentId","leaseId","taskId","logicalKey","repository","action","requestSha256","resultSha256","principalDigest","eventId","outcome","executionObserved"].sort().join(",");
const witnessKeys=["source","authenticated","eventId","provider","action","requestSha256","resultSha256","taskId"].sort().join(",");
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==="object"&&!Array.isArray(x);
const sameKeys=(x:Record<string,unknown>,keys:string)=>Object.keys(x).sort().join(",")===keys;
/** This contract checks shape and correlations ONLY. A trusted adapter MUST obtain
 * the original server event and authenticated witness independently; never accept
 * caller-provided booleans as a substitute for authentication. No automatic L3 PASS.
 */
export function validateCustomMcpExecutionReceipt(raw:unknown,e:ExpectedCustomMcpExecution,witness:unknown):CustomMcpReceiptVerdict{
 if(!obj(raw)||!sameKeys(raw,receiptKeys)||raw.schema!=="queqiao.gate3.connector-execution.v1"||
 raw.provider!=="queqiao_custom_mcp"||raw.outcome!=="success"||raw.executionObserved!==true||
 !SHA.test(String(raw.principalDigest))||
 !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(raw.eventId))||
 !ID.test(String(raw.controllerRunId))||!ATT.test(String(raw.controllerAttempt))||
 !ID.test(String(raw.workerRunId))||!ATT.test(String(raw.workerAttempt))||
 !/^gha_[a-z0-9_]{4,64}$/.test(String(raw.environmentId))||
 !/^[0-9a-f-]{36}$/.test(String(raw.leaseId))||
 !SHA.test(String(raw.requestSha256))||!SHA.test(String(raw.resultSha256)))return "invalid_receipt";
 const fields=(Object.keys(e) as Array<keyof ExpectedCustomMcpExecution>);
 if(fields.some(k=>raw[k]!==e[k]))return "receipt_mismatch";
 if(witness===null||witness===undefined)return "witness_missing";
 if(!obj(witness)||!sameKeys(witness,witnessKeys)||witness.source!=="authenticated_gateway_audit"||witness.authenticated!==true)
 return "witness_untrusted";
 if(witness.eventId!==raw.eventId||witness.provider!==raw.provider||witness.action!==raw.action||
 witness.requestSha256!==raw.requestSha256||witness.resultSha256!==raw.resultSha256||witness.taskId!==raw.taskId)
 return "witness_mismatch";
 return "candidate_for_independent_review";
}
