import { loadRuntimeEnvironment, readRuntimeSecret } from "./runtime-env.mjs";
import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

await loadRuntimeEnvironment();
const approvalSecret = await readRuntimeSecret("OAUTH_APPROVAL_SECRET");
const base = new URL(process.env.PUBLIC_BASE_URL);
const resource = new URL("mcp", base).href;
const redirectUri = "http://127.0.0.1/callback";
const verifier = randomBytes(40).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

async function json(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

const clientRegistration = await json(new URL("oauth/register", base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "Queqiao public smoke", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", scope: "queqiao:access" }),
});

const authorization = new URL("oauth/authorize", base);
for (const [key, value] of Object.entries({ client_id: clientRegistration.client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "queqiao:access", resource, state: "smoke" })) authorization.searchParams.set(key, value);
const page = await fetch(authorization);
if (!page.ok || !(await page.text()).includes("Queqiao")) throw new Error("Authorization page validation failed");

const form = new URLSearchParams(authorization.searchParams);
form.set("approval_secret", approvalSecret);
const approved = await fetch(new URL("oauth/authorize", base), { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
if (approved.status !== 303) throw new Error(`Approval returned ${approved.status}`);
const code = new URL(approved.headers.get("location")).searchParams.get("code");
const token = await json(new URL("oauth/token", base), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientRegistration.client_id, code_verifier: verifier, resource }) });

const client = new Client({ name: "queqiao-public-smoke", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } });
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  const acceptedToolSets = [
    ["workspace_info", "read_file"],
    ["workspace_info", "read_file", "list_workspaces", "open_workspace"],
    ["workspace_info", "read_file", "list_workspaces", "open_workspace", "write_file", "edit_file"],
    ["workspace_info", "read_file", "list_workspaces", "open_workspace", "write_file", "edit_file", "run"],
    ["workspace_info", "read_file", "list_workspaces", "open_workspace", "write_file", "edit_file", "run", "list_directory", "search_text"],
  ];
  if (!acceptedToolSets.some((expected) => JSON.stringify(tools) === JSON.stringify(expected))) throw new Error(`Unexpected tools: ${tools.join(",")}`);
  const info = await client.callTool({ name: "workspace_info", arguments: {} });
  if (info.isError) throw new Error("workspace_info failed");
  let workspaces;
  if (tools.includes("list_workspaces")) {
    workspaces = await client.callTool({ name: "list_workspaces", arguments: {} });
    const opened = await client.callTool({ name: "open_workspace", arguments: { workspaceId: "queqiao" } });
    if (opened.isError) throw new Error("open_workspace(queqiao) failed");
    const read = await client.callTool({ name: "read_file", arguments: { workspaceId: "queqiao", path: "README.md", offset: 0, limit: 1 } });
    if (read.isError || !JSON.stringify(read.content).includes("# Queqiao")) throw new Error("Cross-workspace read failed");
    if (tools.includes("list_directory")) {
      const listedDirectory = await client.callTool({ name: "list_directory", arguments: { workspaceId: "queqiao", path: ".", depth: 1, limit: 20 } });
      if (listedDirectory.isError || !JSON.stringify(listedDirectory.content).includes("README.md")) throw new Error("Directory listing failed");
      const searched = await client.callTool({ name: "search_text", arguments: { workspaceId: "queqiao", query: "secure bridge", globs: ["README.md"], maxResults: 10 } });
      if (searched.isError || !JSON.stringify(searched.content).includes("README.md")) throw new Error("Text search failed");
    }
    if (JSON.stringify(workspaces.content).includes('"irispipe"')) {
      const openedWsl = await client.callTool({ name: "open_workspace", arguments: { workspaceId: "irispipe" } });
      if (openedWsl.isError || !JSON.stringify(openedWsl.content).includes('"environmentId": "wsl"')) throw new Error("WSL workspace routing failed");
      const readWsl = await client.callTool({ name: "read_file", arguments: { workspaceId: "irispipe", path: "CHANGELOG.md", offset: 0, limit: 5 } });
      if (readWsl.isError) throw new Error("WSL native file read failed");
    }
    if (JSON.stringify(workspaces.content).includes('"queqiao-docs"')) {
      const docsRead = await client.callTool({ name: "read_file", arguments: { workspaceId: "queqiao-docs", path: "architecture.md", offset: 0, limit: 2 } });
      if (docsRead.isError || !JSON.stringify(docsRead.content).includes("# Architecture")) throw new Error("Hot-loaded workspace read failed");
    }
    if (JSON.stringify(workspaces.content).includes('"devspace-openai"')) {
      const linuxCliRead = await client.callTool({ name: "read_file", arguments: { workspaceId: "devspace-openai", path: "README.md", offset: 0, limit: 2 } });
      if (linuxCliRead.isError) throw new Error("WSL CLI hot-loaded workspace read failed");
    }
  }
  console.log(JSON.stringify({ ok: true, resource, tools, workspaceInfo: info.content, workspaces: workspaces?.content }, null, 2));
} finally {
  await transport.close();
}
