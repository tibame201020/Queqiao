import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { loadRuntimeEnvironment, readRuntimeSecret } from "./runtime-env.mjs";

await loadRuntimeEnvironment();
const base = new URL(process.env.PUBLIC_BASE_URL);
const approvalSecret = await readRuntimeSecret("OAUTH_APPROVAL_SECRET");
const resource = new URL("mcp", base).href;
const redirectUri = "http://127.0.0.1/callback";
const scopes = "queqiao:access";
const verifier = randomBytes(40).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

async function json(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

const registration = await json(new URL("oauth/register", base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "Queqiao write smoke", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", scope: scopes }),
});
const authorization = new URL("oauth/authorize", base);
for (const [key, value] of Object.entries({ client_id: registration.client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: scopes, resource, state: "write-smoke" })) authorization.searchParams.set(key, value);
const form = new URLSearchParams(authorization.searchParams);
form.set("approval_secret", approvalSecret);
const approved = await fetch(new URL("oauth/authorize", base), { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
if (approved.status !== 303) throw new Error(`Approval returned ${approved.status}`);
const code = new URL(approved.headers.get("location")).searchParams.get("code");
const token = await json(new URL("oauth/token", base), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: registration.client_id, code_verifier: verifier, resource }) });

const client = new Client({ name: "queqiao-write-smoke", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } });
try {
  await client.connect(transport);
  const file = "write-edit-validation.txt";
  const written = await client.callTool({ name: "write_file", arguments: { workspaceId: "write-validation", path: file, content: "before\n" } });
  if (written.isError) throw new Error(`write_file failed: ${JSON.stringify(written.content)}`);
  const edited = await client.callTool({ name: "edit_file", arguments: { workspaceId: "write-validation", path: file, oldText: "before", newText: "after" } });
  if (edited.isError) throw new Error(`edit_file failed: ${JSON.stringify(edited.content)}`);
  const read = await client.callTool({ name: "read_file", arguments: { workspaceId: "write-validation", path: file, offset: 0, limit: 2 } });
  if (read.isError || !JSON.stringify(read.content).includes("after")) throw new Error("write/edit/read result mismatch");
  console.log(JSON.stringify({ ok: true, workspaceId: "write-validation", file, grantedScopes: token.scope }, null, 2));
} finally {
  await transport.close();
}
