import { readFile } from "node:fs/promises";
import { resolveRuntimeLayout } from "@queqiao/platform-paths";

export async function loadRuntimeEnvironment() {
  const layout = resolveRuntimeLayout();
  const source = process.env.QUEQIAO_ENV_FILE || layout.environmentFile;
  const contents = await readFile(source, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
  return layout;
}

export async function readRuntimeSecret(name) {
  const file = process.env[`${name}_FILE`];
  if (file) return (await readFile(file, "utf8")).trim();
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_FILE is required`);
  return value;
}
