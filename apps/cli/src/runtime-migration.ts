import { access, chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimeLayout } from "@queqiao/platform-paths";

type LegacyWorker = { environmentId: string; url: string; token: string };
function parseEnvironment(text: string): Map<string, string> { const values = new Map<string, string>(); for (const line of text.split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match) values.set(match[1]!, match[2]!); } return values; }
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function secureWrite(file: string, value: string) { await writeFile(file, value, { encoding: "utf8", mode: 0o600, flag: "wx" }); await chmod(file, 0o600).catch(() => undefined); }

export async function migrateFromRepository(repository: string, layout: RuntimeLayout, execute: boolean) {
  const legacyEnvironment = path.join(repository, ".env"); const legacyState = path.join(repository, ".queqiao");
  const sources = { environment: legacyEnvironment, workspaces: path.join(legacyState, "workspaces.json"), workers: path.join(legacyState, "workers.json"), gateway: path.join(legacyState, "gateway") };
  for (const required of [sources.environment, sources.workspaces, sources.workers]) if (!(await exists(required))) throw new Error(`Legacy runtime file is missing: ${required}`);
  const targets = { environment: layout.environmentFile, workspaces: layout.workspacesFile, workers: layout.workersFile, gateway: layout.gatewayStateDir };
  for (const target of [targets.environment, targets.workspaces, targets.workers]) if (await exists(target)) throw new Error(`Migration target already exists: ${target}`);
  const plan = { repository, sources, targets, secretsDir: layout.secretsDir, mode: execute ? "execute" : "dry-run" };
  if (!execute) return plan;
  await Promise.all([layout.configDir, layout.dataDir, layout.stateDir, layout.logDir, layout.runtimeDir, layout.secretsDir].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 }).then(() => chmod(directory, 0o700).catch(() => undefined))));
  const legacyEnv = parseEnvironment(await readFile(sources.environment, "utf8"));
  const secretNames = ["OAUTH_APPROVAL_SECRET", "JWT_SIGNING_SECRET", "QUEQIAO_WORKER_TOKEN"] as const;
  const secretFiles = new Map<string, string>();
  for (const name of secretNames) { const value = legacyEnv.get(name); if (!value) throw new Error(`${name} is missing from legacy environment`); const file = path.join(layout.secretsDir, `${name.toLowerCase().replaceAll("_", "-")}.secret`); await secureWrite(file, `${value}\n`); secretFiles.set(name, file); }
  const runtimeValues = new Map(legacyEnv);
  for (const name of secretNames) { runtimeValues.delete(name); runtimeValues.set(`${name}_FILE`, secretFiles.get(name)!); }
  runtimeValues.set("QUEQIAO_STATE_DIR", layout.gatewayStateDir); runtimeValues.set("QUEQIAO_WORKSPACES_FILE", layout.workspacesFile); runtimeValues.set("QUEQIAO_WORKERS_FILE", layout.workersFile);
  await secureWrite(targets.environment, `${[...runtimeValues].map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
  const workspaces = JSON.parse(await readFile(sources.workspaces, "utf8")) as Array<{ id: string; root: string; [key: string]: unknown }>;
  for (const workspace of workspaces) { const relative = path.relative(legacyState, path.resolve(workspace.root)); if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && relative !== "gateway" && !relative.startsWith(`gateway${path.sep}`)) { const destination = path.join(layout.dataDir, "workspaces", workspace.id); await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 }); await cp(workspace.root, destination, { recursive: true, errorOnExist: true }); workspace.root = destination; } }
  await secureWrite(targets.workspaces, `${JSON.stringify(workspaces, null, 2)}\n`);
  const workers = JSON.parse(await readFile(sources.workers, "utf8")) as LegacyWorker[];
  await secureWrite(targets.workers, `${JSON.stringify(workers.map(({ token: _token, ...worker }) => ({ ...worker, tokenFile: secretFiles.get("QUEQIAO_WORKER_TOKEN") })), null, 2)}\n`);
  if (await exists(sources.gateway)) await cp(sources.gateway, targets.gateway, { recursive: true, errorOnExist: true });
  return plan;
}
