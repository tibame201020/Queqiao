import { readFile } from "node:fs/promises";
import { readRuntimeConfig } from "@queqiao/config";
import { requireRuntimeConfigFile } from "@queqiao/platform-paths";

let runtime;
export async function loadRuntimeEnvironment() {
  const configFile = requireRuntimeConfigFile();
  runtime = await readRuntimeConfig(configFile);
  if (runtime.gateway) process.env.PUBLIC_BASE_URL ||= runtime.gateway.publicBaseUrl;
  return configFile;
}
export async function readRuntimeSecret(name) {
  if (!runtime) await loadRuntimeEnvironment();
  const file = name === "OAUTH_APPROVAL_SECRET" ? runtime.gateway?.approvalSecretFile : undefined;
  if (!file) throw new Error(`${name} is not configured`);
  return (await readFile(file, "utf8")).trim();
}
