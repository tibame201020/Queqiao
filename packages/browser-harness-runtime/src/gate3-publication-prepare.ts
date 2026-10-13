import {createHash} from "node:crypto";
import {existsSync,readFileSync,mkdirSync,writeFileSync,appendFileSync} from "node:fs";
import {join,resolve,relative} from "node:path";
import {assessGate3Publication,type Gate3Receipt} from "./gate3-content.js";

/** CI-only: accepts a validated public artifact, never a user-controlled file path or raw browser state. */
const artifactFile=process.argv[2];
const targetRoot=process.argv[3];
if(!artifactFile||!targetRoot)throw Error("GATE3_PUBLISH_ARGS");
let value:unknown;
try{value=JSON.parse(readFileSync(artifactFile,"utf8"));}catch{throw Error("GATE3_INVALID_ARTIFACT");}
if(!value||typeof value!=="object"||Array.isArray(value))throw Error("GATE3_INVALID_ARTIFACT");
const obj=value as Record<string,unknown>;
if(typeof obj["article"]!=="string"||typeof obj["path"]!=="string"||!obj["receipt"]||typeof obj["receipt"]!=="object")
 throw Error("GATE3_INVALID_ARTIFACT");
const receipt=obj["receipt"] as Gate3Receipt;
if(!/^\d{4}-\d{2}-\d{2}$/.test(String(receipt.date??"")))throw Error("GATE3_DATE_INVALID");
const branch=`gate3/synthetic-${receipt.date}`;
const candidate=resolve(targetRoot,obj["path"]);
const rel=relative(resolve(targetRoot),candidate);
if(rel.startsWith("..")||rel.startsWith("/")||rel==="")throw Error("GATE3_UNSAFE_PATH");
const verdict=assessGate3Publication({
 receipt,article:obj["article"],branch,exists:existsSync(candidate),
 hasWriteCredential:Boolean(process.env["SIGNAL_NOTES_GATE3_TOKEN"]),
});
if(verdict!=="publish")throw Error("GATE3_PUBLICATION_"+verdict.toUpperCase());
if(process.env["GATE3_EXPECTED_RUN_ID"]!==receipt.runId)throw Error("GATE3_WRONG_RUN_ID");
mkdirSync(resolve(candidate,".."),{recursive:true});
writeFileSync(candidate,obj["article"],{encoding:"utf8",flag:"wx",mode:0o644});
const env=process.env["GITHUB_ENV"];
if(env)appendFileSync(env,`GATE3_TARGET_BRANCH=${branch}\nGATE3_ARTICLE_PATH=${obj["path"]}\n`,"utf8");
console.log(JSON.stringify({taskId:receipt.taskId,runId:receipt.runId,stage:"publication_prepared",
 articleSha256:createHash("sha256").update(obj["article"]).digest("hex"),branch}));
