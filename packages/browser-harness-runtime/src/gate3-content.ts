import {createHash} from "node:crypto";

type Fields={concept:string;verification:string;limitation:string};
export type Gate3Receipt={
 schema:"queqiao.gate3.receipt.v1";runId:string;taskId:string;date:string;
 status:"completed"|"failed";stage:"validated"|"failed";completed:boolean;
 articleSha256:string;responseSha256:string;path:string;
 authenticated:true;userTurnObserved:true;assistantObserved:true;generationCompleted:true;
};
const hash=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const fail=():never=>{throw new Error("GATE3_INVALID_OUTPUT");};
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const SLUG="gate3-synthetic-";
const isSafeField=(s:unknown):s is string=>{
 if(typeof s!=="string" || s.length<25 || s.length>150 || s.trim()!==s)return false;
 if((s.match(/\p{Script=Han}/gu)||[]).length<15)return false;
 // Synthetic-only allowlist. No URLs, e-mail, Markdown, frontmatter, IDs or browser data.
 if(!/^[\p{Script=Han}，。；：、（）「」！？\s]+$/u.test(s))return false;
 if(/\s{2,}|---|https?:|www\.|@/.test(s))return false;
 return true;
};
export function validateGate3Output(raw:string):Fields{
 if(raw.length>1600||raw.length<100)fail();
 let parsed:unknown;
 try{parsed=JSON.parse(raw.trim());}catch{return fail();}
 if(!parsed || typeof parsed!=="object" || Array.isArray(parsed))fail();
 const obj=parsed as Record<string,unknown>;
 const keys=Object.keys(obj).sort();
 if(keys.join(",")!=="concept,limitation,verification")fail();
 const concept=obj["concept"],verification=obj["verification"],limitation=obj["limitation"];
 if(!isSafeField(concept)||!isSafeField(verification)||!isSafeField(limitation))fail();
 return {concept,verification,limitation};
}
export function makeGate3Artifact(input:{
 runId:string;runAttempt:string;date:string;fields:Fields;
 authenticated:boolean;userTurn:boolean;assistantTurn:boolean;generationFinished:boolean;
}):{article:string;path:string;receipt:Gate3Receipt}{
 const {runId,runAttempt,date,fields}=input;
 if(!input.authenticated||!input.userTurn||!input.assistantTurn||!input.generationFinished||
    !/^\d{1,20}$/.test(runId)||!/^\d{1,8}$/.test(runAttempt)||!validDate(date))throw Error("GATE3_NOT_COMPLETE");
 const safe=validateGate3Output(JSON.stringify(fields));
 const slug=SLUG+date;
 const path=`src/content/posts/${slug}/index.md`;
 const article=[
  "---",
  'title: "Gate 3 合成內容流程測試"',
  `slug: "${slug}"`,
  'description: "僅供驗證 GitHub Actions 與 Browser Harness 的合成內容產線，不是正式文章。"',
  `publishedAt: ${date}`,
  "category:",
  '  name: "工程測試"',
  '  slug: "engineering-test"',
  "tags:",
  '  - name: "合成驗證"',
  '    slug: "synthetic-test"',
  "draft: true",
  "featured: false",
  "---","",
  "> 這是隔離於正式發布的合成驗證文章，不包含新聞或市場研究。","",
  "## 概念","",safe.concept,"",
  "## 驗證步驟","",safe.verification,"",
  "## 限制","",safe.limitation,"",
 ].join("\n");
 const receipt:Gate3Receipt={
  schema:"queqiao.gate3.receipt.v1",runId,taskId:`gate3-${runId}-${runAttempt}`,date,
  status:"completed",stage:"validated",completed:true,
  articleSha256:hash(article),responseSha256:hash(JSON.stringify(safe)),path,
  authenticated:true,userTurnObserved:true,assistantObserved:true,generationCompleted:true,
 };
 return {article,path,receipt};
}
export function assessGate3Publication(input:{
 receipt:Gate3Receipt;article:string;branch:string;exists:boolean;hasWriteCredential:boolean;
}):"publish"|"not_complete"|"forbidden_branch"|"duplicate"|"missing_credential"|"hash_mismatch"{
 const {receipt,article,branch,exists,hasWriteCredential}=input;
 if(receipt.schema!=="queqiao.gate3.receipt.v1"||receipt.status!=="completed"||!receipt.completed||receipt.stage!=="validated"||
  !receipt.authenticated||!receipt.userTurnObserved||!receipt.assistantObserved||!receipt.generationCompleted)return "not_complete";
 if(branch!==`gate3/synthetic-${receipt.date}`||!validDate(receipt.date)||
    receipt.path!==`src/content/posts/${SLUG+receipt.date}/index.md`)return "forbidden_branch";
 if(exists)return "duplicate";
 if(!hasWriteCredential)return "missing_credential";
 if(hash(article)!==receipt.articleSha256 || !article.includes("draft: true"))return "hash_mismatch";
 return "publish";
}
