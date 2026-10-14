import {readFileSync} from "node:fs";
import {verifyHostedGithubArchive} from "./poc-gate3-github-archive.js";
const worker=process.env["G3_AUDIT_ARTIFACT_PATH"],head=process.env["G3_GITHUB_AUDIT_ARTIFACT_PATH"];
if(!worker||!head)throw Error("G3_GITHUB_ARCHIVE_PATH_MISSING");
const read=(p:string)=>{try{return readFileSync(p,"utf8");}catch{throw Error("G3_GITHUB_ARCHIVE_MISSING");}};
const result=verifyHostedGithubArchive(read(worker),read(head),{
 controllerRunId:process.env["GITHUB_RUN_ID"]??"",
 controllerAttempt:process.env["GITHUB_RUN_ATTEMPT"]??"",
 sourceRevision:process.env["GITHUB_SHA"]??"",
});
console.log(JSON.stringify(result));
