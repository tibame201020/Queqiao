import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolveExtensionHubRoot, secureRuntimeDirectory, secureRuntimeFile } from "@queqiao/platform-paths";
import { CORE_PUBLIC_TOOL_ORDER, type CorePublicToolName } from "@queqiao/core-manifest";
import { normalizeAllowedExecutables } from "./access-configuration.js";

export type AccessProfile = {
  name: string;
  tools: CorePublicToolName[];
  allowedExecutables: string[];
};

type ProfileFile = { version: 1; profiles: AccessProfile[] };
const TOOL_NAMES = new Set<string>(CORE_PUBLIC_TOOL_ORDER);

export function resolveAccessProfileFile(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  return path.join(path.dirname(resolveExtensionHubRoot(env, platform)), "access-profiles.json");
}

function normalizeProfile(profile: AccessProfile): AccessProfile {
  const name = profile.name.trim();
  if (!name) throw new Error("Access profile name is required");
  if (name.length > 128) throw new Error("Access profile name must be 128 characters or fewer");
  const tools = [...new Set(profile.tools)];
  for (const tool of tools) {
    if (!TOOL_NAMES.has(tool)) throw new Error(`Unknown tool in access profile: ${tool}`);
  }
  return {
    name,
    tools,
    allowedExecutables: tools.includes("run") ? normalizeAllowedExecutables(profile.allowedExecutables.join(",")) : [],
  };
}

export class AccessProfileStore {
  constructor(private readonly file: string) {}

  async list(): Promise<AccessProfile[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<ProfileFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) return [];
      return parsed.profiles.map((profile) => normalizeProfile(profile));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async save(profile: AccessProfile): Promise<void> {
    const normalized = normalizeProfile(profile);
    const current = await this.list();
    const next = [
      ...current.filter((entry) => entry.name.toLowerCase() !== normalized.name.toLowerCase()),
      normalized,
    ].sort((left, right) => left.name.localeCompare(right.name));
    await mkdir(path.dirname(this.file), { recursive: true });
    await secureRuntimeDirectory(path.dirname(this.file));
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, profiles: next }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await secureRuntimeFile(temporary);
    await rename(temporary, this.file);
    await secureRuntimeFile(this.file);
  }
}
