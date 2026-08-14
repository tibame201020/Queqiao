import { access, chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { serializeRuntimeConfig } from "@queqiao/config";
import type { RuntimeLayout } from "@queqiao/platform-paths";

type LegacyWorker = { environmentId: string; url: string; token: string };
function parseEnvironment(text: string): Map<string, string> { const values = new Map<string, string>(); for (const line of text.split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match) values.set(match[1]!, match[2]!); } return values; }
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function secureWrite(file: string, value: string) { await writeFile(file, value, { encoding: "utf8", mode: 0o600, flag: "wx" }); await chmod(file, 0o600).catch(() => undefined); }
function required(values: Map<string, string>, key: string): string { const value = values.get(key); if (!value) throw new Error(`${key} is missing from legacy environment`); return value; }

export async function migrateFromRepository(repository: string, layout: RuntimeLayout, execute: boolean) {
  const legacyEnvironment = path.join(repository, ".env"); const legacyState = path.join(repository, ".queqiao");
  const sources = { environment: legacyEnvironment, workspaces: path.join(legacyState, "workspaces.json"), workers: path.join(legacyState, "workers.json"), gateway: path.join(legacyState, "gateway") };
  for (const requiredFile of [sources.environment, sources.workspaces, sources.workers]) if (!(await exists(requiredFile))) throw new Error(`Legacy runtime file is missing: ${requiredFile}`);
  const targets = { config: layout.configFile, gateway: layout.gatewayStateDir };
  if (await exists(targets.config)) throw new Error(`Migration target already exists: ${targets.config}`);
  const plan = { repository, sources, targets, secretsDir: layout.secretsDir, mode: execute ? "execute" : "dry-run" };
  if (!execute) return plan;
  await Promise.all([layout.configDir, layout.dataDir, layout.stateDir, layout.logDir, layout.runtimeDir, layout.secretsDir].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 }).then(() => chmod(directory, 0o700).catch(() => undefined))));
  const legacyEnv = parseEnvironment(await readFile(sources.environment, "utf8"));
  const secretNames = ["OAUTH_APPROVAL_SECRET", "JWT_SIGNING_SECRET", "QUEQIAO_WORKER_TOKEN"] as const;
  const secretFiles = new Map<string, string>();
  for (const name of secretNames) { const file = path.join(layout.secretsDir, `${name.toLowerCase().replaceAll("_", "-")}.secret`); await secureWrite(file, `${required(legacyEnv, name)}\n`); secretFiles.set(name, file); }
  const workspaces = JSON.parse(await readFile(sources.workspaces, "utf8")) as Array<{ id: string; root: string; displayName: string; profile?: string; tools?: unknown; commands?: unknown; [key: string]: unknown }>;
  for (const workspace of workspaces) { const relative = path.relative(legacyState, path.resolve(workspace.root)); if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && relative !== "gateway" && !relative.startsWith(`gateway${path.sep}`)) { const destination = path.join(layout.dataDir, "workspaces", workspace.id); await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 }); await cp(workspace.root, destination, { recursive: true, errorOnExist: true }); workspace.root = destination; } }
  const legacyWorkers = JSON.parse(await readFile(sources.workers, "utf8")) as LegacyWorker[];
  const config = {
    version: 1 as const,
    gateway: {
      publicBaseUrl: required(legacyEnv, "PUBLIC_BASE_URL"),
      listen: { host: "127.0.0.1", port: Number(legacyEnv.get("PORT") || 7575) },
      trustProxyHops: Number(legacyEnv.get("TRUST_PROXY_HOPS") || 1),
      stateDirectory: layout.gatewayStateDir,
      approvalSecretFile: secretFiles.get("OAUTH_APPROVAL_SECRET")!, jwtSigningSecretFile: secretFiles.get("JWT_SIGNING_SECRET")!,
      allowedRedirectOrigins: (legacyEnv.get("OAUTH_ALLOWED_REDIRECT_ORIGINS") || "https://chatgpt.com,http://127.0.0.1,http://localhost").split(","),
    },
    worker: { environmentId: legacyEnv.get("QUEQIAO_ENVIRONMENT_ID") || "windows", listen: { host: "127.0.0.1" as const, port: Number(legacyEnv.get("QUEQIAO_WORKER_PORT") || 7576) }, tokenFile: secretFiles.get("QUEQIAO_WORKER_TOKEN")!, defaultWorkspaceId: legacyEnv.get("QUEQIAO_WORKSPACE_ID") || workspaces[0]?.id || "default" },
    environments: legacyWorkers.map(({ token: _token, ...worker }) => ({ ...worker, tokenFile: secretFiles.get("QUEQIAO_WORKER_TOKEN")! })),
    workspaces,
  };
  await secureWrite(targets.config, serializeRuntimeConfig(config));
  if (await exists(sources.gateway)) await cp(sources.gateway, targets.gateway, { recursive: true, errorOnExist: true });
  return plan;
}

export async function migrateRuntimeLayoutV1(layout: RuntimeLayout, execute: boolean) {
  const environmentFile = path.join(layout.configDir, "runtime.env"); const workspacesFile = path.join(layout.configDir, "workspaces.json"); const workersFile = path.join(layout.configDir, "workers.json");
  for (const requiredFile of [environmentFile, workspacesFile]) if (!(await exists(requiredFile))) throw new Error(`Runtime v1 file is missing: ${requiredFile}`);
  if (await exists(layout.configFile)) throw new Error(`Migration target already exists: ${layout.configFile}`);
  const plan = { sources: { environmentFile, workspacesFile, workersFile }, target: layout.configFile, mode: execute ? "execute" : "dry-run" };
  if (!execute) return plan;
  const env = parseEnvironment(await readFile(environmentFile, "utf8")); const workspaces = JSON.parse(await readFile(workspacesFile, "utf8"));
  const environments = await exists(workersFile) ? JSON.parse(await readFile(workersFile, "utf8")) : [];
  const approvalSecretFile = env.get("OAUTH_APPROVAL_SECRET_FILE"); const jwtSigningSecretFile = env.get("JWT_SIGNING_SECRET_FILE"); const workerTokenFile = env.get("QUEQIAO_WORKER_TOKEN_FILE");
  const gateway = approvalSecretFile && jwtSigningSecretFile && env.get("PUBLIC_BASE_URL") ? { publicBaseUrl: env.get("PUBLIC_BASE_URL"), listen: { host: "127.0.0.1", port: Number(env.get("PORT") || 7575) }, trustProxyHops: Number(env.get("TRUST_PROXY_HOPS") || 1), stateDirectory: env.get("QUEQIAO_STATE_DIR") || layout.gatewayStateDir, approvalSecretFile, jwtSigningSecretFile, allowedRedirectOrigins: (env.get("OAUTH_ALLOWED_REDIRECT_ORIGINS") || "https://chatgpt.com,http://127.0.0.1,http://localhost").split(",") } : undefined;
  const worker = workerTokenFile ? { environmentId: env.get("QUEQIAO_ENVIRONMENT_ID") || "local", listen: { host: "127.0.0.1" as const, port: Number(env.get("QUEQIAO_WORKER_PORT") || 7576) }, tokenFile: workerTokenFile, defaultWorkspaceId: env.get("QUEQIAO_WORKSPACE_ID") || workspaces[0]?.id || "default" } : undefined;
  await secureWrite(layout.configFile, serializeRuntimeConfig({ version: 1, ...(gateway ? { gateway } : {}), ...(worker ? { worker } : {}), environments, workspaces }));
  return plan;
}
