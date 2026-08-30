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
    ];
    await this.write(next);
  }

  async get(name: string): Promise<AccessProfile | undefined> {
    const key = name.trim().toLowerCase();
    return (await this.list()).find((entry) => entry.name.toLowerCase() === key);
  }

  async rename(name: string, nextName: string): Promise<AccessProfile> {
    const current = await this.list();
    const key = name.trim().toLowerCase();
    const selected = current.find((entry) => entry.name.toLowerCase() === key);
    if (!selected) throw new Error(`Access profile not found: ${name}`);
    const normalized = normalizeProfile({ ...selected, name: nextName });
    if (current.some((entry) => entry.name.toLowerCase() === normalized.name.toLowerCase() && entry.name.toLowerCase() !== key)) {
      throw new Error(`Access profile already exists: ${normalized.name}`);
    }
    await this.write(current.map((entry) => entry.name.toLowerCase() === key ? normalized : entry));
    return normalized;
  }

  async delete(name: string): Promise<AccessProfile> {
    const current = await this.list();
    const key = name.trim().toLowerCase();
    const selected = current.find((entry) => entry.name.toLowerCase() === key);
    if (!selected) throw new Error(`Access profile not found: ${name}`);
    await this.write(current.filter((entry) => entry.name.toLowerCase() !== key));
    return selected;
  }

  private async write(profiles: AccessProfile[]): Promise<void> {
    const next = profiles.map((profile) => normalizeProfile(profile)).sort((left, right) => left.name.localeCompare(right.name));
    await mkdir(path.dirname(this.file), { recursive: true });
    await secureRuntimeDirectory(path.dirname(this.file));
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, profiles: next }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await secureRuntimeFile(temporary);
    await rename(temporary, this.file);
    await secureRuntimeFile(this.file);
  }
}
