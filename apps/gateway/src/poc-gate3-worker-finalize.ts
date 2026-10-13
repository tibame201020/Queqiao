import {readFileSync,writeFileSync} from "node:fs";
import {completeGate3WorkerEvidence} from "./poc-gate3-worker-completion.js";
const env=process.env;
const inPath=env["G3_PROOF_PATH"],outPath=env["G3_FINAL_PROOF_PATH"];
if(!inPath||!outPath)throw Error("G3_CONTROLLER_PROOF_PATH_MISSING");
let raw:unknown;
try{raw=JSON.parse(readFileSync(inPath,"utf8"));}catch{throw Error("G3_CONTROLLER_PROOF_READ_FAILED");}
const result=completeGate3WorkerEvidence(raw,{
 controllerRunId:env["GITHUB_RUN_ID"]??"",controllerAttempt:env["GITHUB_RUN_ATTEMPT"]??"",
 workerRunId:env["G3_EXPECTED_WORKER_RUN_ID"]??"",
 environmentId:env["G3_EXPECTED_ENVIRONMENT_ID"]??"",
 leaseId:env["G3_EXPECTED_LEASE_ID"]??"",date:env["G3_EXPECTED_DATE"]??"",
 leaseState:env["G3_VERIFIED_LEASE_STATE"]??"",
 workerConclusion:env["G3_VERIFIED_WORKER_CONCLUSION"]??"",
});
writeFileSync(outPath,JSON.stringify(result)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
console.log(JSON.stringify(result));
