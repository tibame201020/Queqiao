import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { verifyRoutedGate3Content } from "./poc-gate3-worker-receipt.js";
import { writeFile } from "node:fs/promises";
import {validateCustomMcpExecutionReceipt} from "./poc-gate3-connector-execution.js";
import {gate3ReadRequestHash,type Gate3McpBinding} from "./poc-gate3-audit-read.js";

// This acceptance client is only run inside a manually approved GitHub Actions
// controller. Do not put OAuth artifacts or approval credentials into logs.
const localBase = process.env["QUEQIAO_POC_LOCAL_URL"] ?? "http://127.0.0.1:7575";
const publicBase = process.env["QUEQIAO_POC_PUBLIC_URL"];
const secretFile = process.env["QUEQIAO_POC_APPROVAL_SECRET_FILE"];
const environmentId = process.env["QUEQIAO_POC_ENVIRONMENT_ID"];
if (!publicBase || !secretFile || !environmentId) throw new Error("Incomplete POC runtime configuration");

const approvalSecret = (await readFile(secretFile, "utf8")).trim();
const resource = new URL("mcp", publicBase.endsWith("/") ? publicBase : publicBase + "/").href;
const redirect = "https://chatgpt.com/connector/oauth/callback";
const verifier = randomBytes(40).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

async function jsonPost(route: string, data: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(route, localBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`OAuth ${route} returned HTTP ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

async function formPost(route: string, data: Record<string, string>, redirectMode: "manual" | "follow"): Promise<Response> {
  return fetch(new URL(route, localBase), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data),
    redirect: redirectMode,
    signal: AbortSignal.timeout(20_000),
  });
}

const registration = await jsonPost("/oauth/register", {
  client_name: "Queqiao Actions Runtime Tool Acceptance",
  redirect_uris: [redirect],
  token_endpoint_auth_method: "none",
  scope: "queqiao:access",
});
const clientId = registration["client_id"];
if (typeof clientId !== "string") throw new Error("OAuth client registration lacked client_id");

const authorization = {
  client_id: clientId,
  redirect_uri: redirect,
  response_type: "code",
  code_challenge: challenge,
  code_challenge_method: "S256",
  scope: "queqiao:access",
  resource,
  state: "github-actions-mcp-tool-acceptance",
};
const approved = await formPost("/oauth/authorize", {
  ...authorization,
  approval_secret: approvalSecret,
}, "manual");
if (approved.status !== 303) throw new Error(`OAuth authorization returned HTTP ${approved.status}`);
const callback = approved.headers.get("location");
const code = callback ? new URL(callback).searchParams.get("code") : null;
if (!code) throw new Error("OAuth authorization code missing");

const tokenResult = await formPost("/oauth/token", {
  grant_type: "authorization_code",
  code,
  redirect_uri: redirect,
  client_id: clientId,
  code_verifier: verifier,
  resource,
}, "manual");
if (!tokenResult.ok) throw new Error(`OAuth token returned HTTP ${tokenResult.status}`);
const tokenPayload = await tokenResult.json() as { access_token?: unknown };
if (typeof tokenPayload.access_token !== "string") throw new Error("OAuth access token missing");

const client = new Client(
  { name: "queqiao-actions-tool-poc", version: "1" },
  { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } },
);
const transport = new StreamableHTTPClientTransport(new URL("mcp", localBase.endsWith("/") ? localBase : localBase + "/"), {
  requestInit: { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } },
});

const workerRunId=process.env["QUEQIAO_POC_WORKER_RUN_ID"];
const controllerRunId=process.env["QUEQIAO_POC_CONTROLLER_RUN_ID"];
const controllerAttempt=process.env["QUEQIAO_POC_CONTROLLER_RUN_ATTEMPT"];
const date=process.env["QUEQIAO_POC_GATE3_DATE"];
const output=process.env["QUEQIAO_POC_G3_PROOF_PATH"];
if(!workerRunId||!controllerRunId||!controllerAttempt||!date||!output)
 throw Error("G3_WORKER_CORRELATION_MISSING");
try {
  await client.connect(transport);
  // Poll one public JSON file, never read a session, raw conversation or profile.
  // Fail closed if Worker produced a malformed result; missing file remains unproven.
  const deadline=Date.now()+570_000;
  let verified:ReturnType<typeof verifyRoutedGate3Content>|undefined;
  while(Date.now()<deadline){
    const file=await client.callTool({
      name:"read_file",
      arguments:{workspaceId:"runtime",environmentId,path:"gate3-artifact.json",offset:0,limit:1},
    },{timeout:30_000});
    if(!file.isError){
      verified=verifyRoutedGate3Content(file,{environmentId,workerRunId,
        controllerRunId,controllerAttempt,date});
      break;
    }
    await new Promise<void>(resolve=>setTimeout(resolve,3000));
  }
  if(!verified)throw Error("G3_WORKER_ARTIFACT_NOT_OBSERVED");
  await writeFile(output,JSON.stringify(verified)+"\n",{flag:"wx",mode:0o600});
  if(process.env["G3_MCP_AUDIT"]==="1"){
    const receiptPath=process.env["QUEQIAO_POC_G3_MCP_RECEIPT_PATH"];
    const leaseId=process.env["QUEQIAO_POC_LEASE_ID"];
    const repository=process.env["GITHUB_REPOSITORY"]??"";
    if(!receiptPath||!leaseId||!repository)throw Error("G3_MCP_ACCEPTANCE_INPUT_MISSING");
    const b:Gate3McpBinding={controllerRunId,controllerAttempt,
      workerRunId,workerAttempt:"1",environmentId,leaseId,date,repository};
    // Exactly one normal MCP tools/call. Do not retry a possibly executed operation.
    const called=await client.callTool({name:"gate3_read_artifact",arguments:{}},{timeout:40_000});
    if(called.isError)throw Error("G3_MCP_SERVER_READ_FAILED");
    const raw=called.content?.find(x=>x.type==="text")?.text;
    let receipt:unknown;
    try{receipt=JSON.parse(typeof raw==="string"?raw:"");}
    catch{throw Error("G3_MCP_RECEIPT_FORMAT_INVALID");}
    const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
    const expected={controllerRunId,controllerAttempt,workerRunId,workerAttempt:"1",
      environmentId,leaseId,taskId:verified.taskId,logicalKey:verified.logicalKey,
      repository,action:"read_gate3_artifact",requestSha256:gate3ReadRequestHash(b),
      resultSha256:hash(JSON.stringify(verified))};
    if(validateCustomMcpExecutionReceipt(receipt,expected,null)!=="witness_missing")
      throw Error("G3_MCP_RECEIPT_MISMATCH");
    await writeFile(receiptPath,JSON.stringify(receipt)+"\n",{flag:"wx",mode:0o600});
  }
  console.log(JSON.stringify(verified));
}finally{
  await client.close();
}
