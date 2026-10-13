import {readFileSync} from "node:fs";
import {assessGate3Trace} from "./gate3-trace.js";
import type {Gate3Receipt} from "./gate3-content.js";

/** Main-only CI validation: prints only sanitized provenance, never raw content. */
const inputPath=process.argv[2];
if(!inputPath)throw Error("GATE3_TRACE_INPUT_MISSING");
const expected={runId:process.env["GATE3_EXPECTED_RUN_ID"]??"",
 runAttempt:process.env["GATE3_EXPECTED_RUN_ATTEMPT"]??""};
if(!/^\d{1,20}$/.test(expected.runId)||!/^\d{1,8}$/.test(expected.runAttempt))
 throw Error("GATE3_TRACE_RUN_MISSING");
let raw:unknown;
try{raw=JSON.parse(readFileSync(inputPath,"utf8"));}catch{throw Error("GATE3_TRACE_UNREADABLE");}
if(!raw||typeof raw!=="object"||Array.isArray(raw)||
 Object.keys(raw).sort().join(",")!=="article,path,receipt,trace")
 throw Error("GATE3_TRACE_INVALID_ENVELOPE");
const value=raw as {article:unknown;path:unknown;receipt:unknown;trace:unknown};
if(typeof value.article!=="string"||typeof value.path!=="string"||
 !value.receipt||typeof value.receipt!=="object"||Array.isArray(value.receipt))
 throw Error("GATE3_TRACE_INVALID_ENVELOPE");
const artifact={article:value.article,path:value.path,receipt:value.receipt as Gate3Receipt};
const verdict=assessGate3Trace(artifact,value.trace,expected);
if(verdict!=="valid")throw Error("GATE3_TRACE_"+verdict.toUpperCase());
const trace=value.trace as {taskId:string;articleSha256:string;logicalKey:string};
console.log(JSON.stringify({schema:"queqiao.gate3.trace-check.v1",runId:expected.runId,
 taskId:trace.taskId,logicalKey:trace.logicalKey,stage:"content_validated",
 articleSha256:trace.articleSha256,verified:true,connectorVerified:false,workerVerified:false}));
