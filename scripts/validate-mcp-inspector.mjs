#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = text; }
  if (!response.ok) throw new Error(`${init?.method || "GET"} ${new URL(url).pathname} returned ${response.status}: ${typeof body === "string" ? body.slice(0, 240) : JSON.stringify(body)}`);
  return { response, body };
}

function inspector(packageName, configPath, method, extra = []) {
  const npxArgs = ["-y", packageName, "--cli", "--config", configPath, "--server", "shadow", "--method", method, ...extra, "--format", "json"];
  const executable = process.platform === "win32" ? process.execPath : "npx";
  const args = process.platform === "win32"
    ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"), ...npxArgs]
    : npxArgs;
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`MCP Inspector ${method} failed (${result.status}): ${(result.stderr || result.stdout || "").slice(0, 1200)}`);
  const stdout = result.stdout.trim();
  if (!stdout) throw new Error(`MCP Inspector ${method} returned no JSON output`);
  try { return JSON.parse(stdout); }
  catch { throw new Error(`MCP Inspector ${method} returned non-JSON stdout: ${stdout.slice(0, 1200)}`); }
}

function textPayload(result, label) {
  const entry = result?.result?.content?.find?.((item) => item?.type === "text");
  if (!entry?.text) throw new Error(`${label} did not return a text MCP payload`);
  try { return JSON.parse(entry.text); }
  catch { throw new Error(`${label} returned non-JSON text payload`); }
}

const base = new URL(requiredOption("--base-url"));
if (base.protocol !== "https:") throw new Error("--base-url must use HTTPS");
if (!base.pathname.endsWith("/")) base.pathname += "/";
const approvalSecretFile = path.resolve(requiredOption("--approval-secret-file"));
const windowsWorkspace = requiredOption("--windows-workspace");
const wslWorkspace = requiredOption("--wsl-workspace");
const windowsEnvironment = option("--windows-environment", "windows");
const wslEnvironment = option("--wsl-environment", "wsl");
const packageName = option("--inspector-package", "@modelcontextprotocol/inspector@2.2.0");
const callbackUrl = option("--callback-url", "http://127.0.0.1:6276/oauth/callback");
const resource = new URL("mcp", base).href;
const approvalSecret = (await readFile(approvalSecretFile, "utf8")).trim();
if (!approvalSecret) throw new Error("approval secret file is empty");

const verifier = base64url(randomBytes(48));
const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
const state = randomBytes(18).toString("base64url");
const registration = (await jsonFetch(new URL("oauth/register", base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "Queqiao MCP Inspector interoperability gate", redirect_uris: [callbackUrl], scope: "queqiao:access" }),
})).body;
if (!registration?.client_id) throw new Error("dynamic client registration returned no client_id");

const authorization = new URLSearchParams({
  client_id: registration.client_id,
  redirect_uri: callbackUrl,
  response_type: "code",
  code_challenge: challenge,
  code_challenge_method: "S256",
  scope: "queqiao:access",
  resource,
  state,
  approval_secret: approvalSecret,
});
const authorizeResponse = await fetch(new URL("oauth/authorize", base), {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: authorization,
  redirect: "manual",
});
if (authorizeResponse.status !== 303) throw new Error(`OAuth authorization returned ${authorizeResponse.status}`);
const location = authorizeResponse.headers.get("location");
if (!location) throw new Error("OAuth authorization returned no redirect location");
const callback = new URL(location);
if (callback.origin + callback.pathname !== new URL(callbackUrl).origin + new URL(callbackUrl).pathname) throw new Error("OAuth authorization redirected to an unexpected callback");
if (callback.searchParams.get("state") !== state) throw new Error("OAuth state mismatch");
const code = callback.searchParams.get("code");
if (!code) throw new Error("OAuth authorization returned no code");

const token = (await jsonFetch(new URL("oauth/token", base), {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl, client_id: registration.client_id, code_verifier: verifier, resource }),
})).body;
if (!token?.access_token) throw new Error("OAuth token exchange returned no access token");

const temporary = await mkdtemp(path.join(tmpdir(), "queqiao-mcp-inspector-"));
const configPath = path.join(temporary, "inspector.json");
try {
  await writeFile(configPath, JSON.stringify({ mcpServers: { shadow: { type: "http", url: resource, headers: { Authorization: `Bearer ${token.access_token}` } } } }), { encoding: "utf8", mode: 0o600 });

  const toolsResult = inspector(packageName, configPath, "tools/list");
  const tools = toolsResult?.result?.tools;
  if (!Array.isArray(tools)) throw new Error("MCP Inspector tools/list returned no tools array");
  const names = tools.map((tool) => tool.name).sort();
  const expectedNames = [
    "workspace_info", "list_workspaces", "open_workspace", "read_file", "write_file", "edit_file", "list_directory", "search_text", "run", "shell",
    "git_repositories", "git_status", "git_diff", "git_log", "git_branches", "git_worktree_create", "git_worktree_remove",
  ].sort();
  const workspaceInfo = tools.find((tool) => tool.name === "workspace_info");
  const gitTools = names.filter((name) => name.startsWith("git_"));
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) throw new Error(`public tool names differ from the 17-tool candidate contract: ${names.join(", ")}`);
  if (!workspaceInfo?.inputSchema?.properties?.workspaceId) throw new Error("workspace_info is not targetable by workspaceId");
  if (gitTools.length !== 7) throw new Error(`expected 7 named Git tools, observed ${gitTools.length}`);

  const listResult = inspector(packageName, configPath, "tools/call", ["--tool-name", "list_workspaces"]);
  const listed = textPayload(listResult, "list_workspaces");
  if (listed?.deployment?.coreManifestRevision !== 6) throw new Error(`expected Core Manifest Revision 6, observed ${listed?.deployment?.coreManifestRevision}`);
  if (listed?.deployment?.publicToolCount !== 17) throw new Error(`expected publicToolCount 17, observed ${listed?.deployment?.publicToolCount}`);
  if (listed?.deployment?.workerProtocolVersion !== "3.0") throw new Error(`expected Worker Protocol 3.0, observed ${listed?.deployment?.workerProtocolVersion}`);
  if (!/^sha256:[0-9a-f]{64}$/.test(listed?.deployment?.deploymentManifestFingerprint || "")) throw new Error("deployment fingerprint is missing or malformed");
  const expectedMcpVersions = ["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"];
  if (JSON.stringify([...(listed?.deployment?.supportedMcpProtocolVersions || [])].sort()) !== JSON.stringify([...expectedMcpVersions].sort())) throw new Error("supported MCP revision attestation does not match the bounded compatibility window");

  const workspaceCall = (workspaceId) => inspector(packageName, configPath, "tools/call", ["--tool-name", "workspace_info", "--tool-args-json", JSON.stringify({ workspaceId })]);
  const windowsInfo = textPayload(workspaceCall(windowsWorkspace), "workspace_info Windows");
  const wslInfo = textPayload(workspaceCall(wslWorkspace), "workspace_info WSL");
  if (windowsInfo.workspaceId !== windowsWorkspace || windowsInfo.environmentId !== windowsEnvironment) throw new Error("Windows workspace_info routing mismatch");
  if (wslInfo.workspaceId !== wslWorkspace || wslInfo.environmentId !== wslEnvironment) throw new Error("WSL workspace_info routing mismatch");

  const gitStatus = (workspaceId) => textPayload(inspector(packageName, configPath, "tools/call", ["--tool-name", "git_status", "--tool-args-json", JSON.stringify({ workspaceId, repositoryPath: "." })]), `git_status ${workspaceId}`);
  const windowsGit = gitStatus(windowsWorkspace);
  const wslGit = gitStatus(wslWorkspace);

  console.log(JSON.stringify({
    client: packageName,
    transport: "streamable-http",
    toolCount: tools.length,
    gitToolCount: gitTools.length,
    workspaceInfoTargetable: true,
    deployment: listed.deployment,
    routing: {
      windows: { workspaceId: windowsInfo.workspaceId, environmentId: windowsInfo.environmentId },
      wsl: { workspaceId: wslInfo.workspaceId, environmentId: wslInfo.environmentId },
    },
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
