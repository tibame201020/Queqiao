import {createGate3ConnectorMarker,GATE3_CONNECTOR_TARGET,assessGate3ConnectorEvidence} from "./gate3-connector-contract.js";
const mode=process.argv[2];
if(mode!=="preflight"&&mode!=="verify")throw Error("GATE3_CONNECTOR_INVALID_MODE");
const marker=createGate3ConnectorMarker(process.env["GITHUB_RUN_ID"]??"",process.env["GITHUB_RUN_ATTEMPT"]??"");
const root="https://api.github.com/repos/"+GATE3_CONNECTOR_TARGET.repository;
const headers={Accept:"application/vnd.github+json","User-Agent":"Queqiao-Gate3-public-verifier"};
async function readJSON(url:string):Promise<unknown>{
 const r=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error("GATE3_CONNECTOR_PUBLIC_GITHUB_UNAVAILABLE");
 return await r.json() as unknown;
}
type PR={draft?:boolean;head?:{ref?:string};base?:{ref?:string};state?:string};
type Comment={body?:string;user?:{login?:string}};
const pr=await readJSON(root+"/pulls/"+GATE3_CONNECTOR_TARGET.pr) as PR;
const target={draft:pr.draft===true&&pr.state==="open",head:pr.head?.ref??"",base:pr.base?.ref??""};
if(!target.draft||target.head!==GATE3_CONNECTOR_TARGET.branch||target.base!=="main")
 throw Error("GATE3_CONNECTOR_WRONG_TARGET");
if(mode==="preflight"){
 console.log(JSON.stringify({schema:"queqiao.gate3.connector-proof.v1",stage:"target_checked",
  draft:true,branchMatched:true,verified:false}));
}else{
 let verified=false;
 for(let i=0;i<12;i++){
  const data=await readJSON(root+"/issues/"+GATE3_CONNECTOR_TARGET.pr+"/comments?per_page=100") as Comment[];
  if(!Array.isArray(data))throw Error("GATE3_CONNECTOR_INVALID_PUBLIC_RESPONSE");
  const comments=data.map(c=>({body:c.body??"",user:{login:c.user?.login??""}}));
  if(assessGate3ConnectorEvidence(marker,{...target,comments})==="verified"){
   verified=true;break;
  }
  if(i<11)await new Promise<void>(resolve=>setTimeout(resolve,5000));
 }
 if(!verified)throw Error("GATE3_CONNECTOR_EXTERNAL_PROOF_MISSING");
 console.log(JSON.stringify({schema:"queqiao.gate3.connector-proof.v1",
  runId:process.env["GITHUB_RUN_ID"],taskId:"gate3-"+process.env["GITHUB_RUN_ID"]+"-"+process.env["GITHUB_RUN_ATTEMPT"],
  stage:"verified",status:"completed",verified:true,targetDraft:true,branchMatched:true,
  commentExact:true,commentAuthorAuthorized:true}));
}
