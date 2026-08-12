import { readFile } from "node:fs/promises";
import { readRuntimeConfig } from "@queqiao/config";
import { resolveRuntimeLayout } from "@queqiao/platform-paths";

let runtime;
export async function loadRuntimeEnvironment() {
  const layout = resolveRuntimeLayout();
  runtime = await readRuntimeConfig(process.env.QUEQIAO_CONFIG_FILE || layout.configFile);
  if (runtime.gateway) process.env.PUBLIC_BASE_URL ||= runtime.gateway.publicBaseUrl;
  return layout;
}
export async function readRuntimeSecret(name) {
  if (!runtime) await loadRuntimeEnvironment();
  const file = name === "OAUTH_APPROVAL_SECRET" ? runtime.gateway?.approvalSecretFile : undefined;
  if (!file) throw new Error(`${name} is not configured`);
  return (await readFile(file, "utf8")).trim();
}
