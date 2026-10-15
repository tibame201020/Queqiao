const SHA40=/^[0-9a-f]{40}$/,SHA64=/^[0-9a-f]{64}$/;
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,names:string[])=>Object.keys(v).sort().join(',')===names.sort().join(',');
const invalid=():never=>{throw Error('G34_TARGET_READBACK_INVALID');};

type TargetExpected={repository:string;base:string;branch:string;path:string;articleSha256:string;baseSha:string};
/** Only validates consistency of fields that MUST be fetched independently from GitHub.
 * The caller MUST use a trusted authenticated original source for each returned field.
 * This pure function cannot authenticate caller-supplied JSON and does not prove Hosted write.
 */
export function assessRestrictedDraftReadback(e:TargetExpected,raw:unknown){
 const slug=/^gate3\/synthetic-(\d{4}-\d{2}-\d{2})$/.exec(e.branch);
 if(e.repository!=='tibame201020/signal-notes'||e.base!=='main'||!slug||
  Number.isNaN(Date.parse(slug[1]!))||new Date(slug[1]!).toISOString().slice(0,10)!==slug[1]||
  e.path!==`src/content/posts/gate3-synthetic-${slug[1]}/index.md`||
  !SHA40.test(e.baseSha)||!SHA64.test(e.articleSha256))return invalid();
 if(!obj(raw)||!exact(raw,['repository','base','branch','branchSha','commit','file','pr','checks'])||
  raw.repository!==e.repository||raw.base!==e.base||raw.branch!==e.branch||
  typeof raw.branchSha!=='string'||!SHA40.test(raw.branchSha)||raw.branchSha===e.baseSha||
  !obj(raw.commit)||!exact(raw.commit,['sha','parents','changedFiles'])||
  raw.commit.sha!==raw.branchSha||!Array.isArray(raw.commit.parents)||
  raw.commit.parents.length!==1||raw.commit.parents[0]!==e.baseSha||
  !Array.isArray(raw.commit.changedFiles)||raw.commit.changedFiles.length!==1)return invalid();
 const changed=raw.commit.changedFiles[0];
 if(!obj(changed)||!exact(changed,['path','status'])||changed.path!==e.path||changed.status!=='added')return invalid();
 if(!obj(raw.file)||!exact(raw.file,['path','blobSha','articleSha256','draft'])||
  raw.file.path!==e.path||typeof raw.file.blobSha!=='string'||!SHA40.test(raw.file.blobSha)||
  raw.file.articleSha256!==e.articleSha256||raw.file.draft!==true)return invalid();
 if(!obj(raw.pr)||!exact(raw.pr,['number','state','draft','head','base','headSha','changedFiles','files'])||
  !Number.isSafeInteger(raw.pr.number)||Number(raw.pr.number)<1||raw.pr.state!=='open'||
  raw.pr.draft!==true||raw.pr.head!==e.branch||raw.pr.base!==e.base||
  raw.pr.headSha!==raw.branchSha||raw.pr.changedFiles!==1||
  !Array.isArray(raw.pr.files)||raw.pr.files.length!==1||raw.pr.files[0]!==e.path)return invalid();
 if(!Array.isArray(raw.checks)||raw.checks.length!==1)return invalid();
 const check=raw.checks[0];
 if(!obj(check)||!exact(check,['name','status','conclusion','headSha'])||
  check.name!=='content'||check.status!=='completed'||check.conclusion!=='success'||
  check.headSha!==raw.branchSha)return invalid();
 return {schema:'queqiao.gate3.target-readback.v1' as const,
  result:'operator_assisted_target_consistent' as const,headSha:raw.branchSha,prNumber:Number(raw.pr.number),
  articleSha256:e.articleSha256,hostedWriteObserved:false as const,fullGatePassed:false as const};
}
